import { Server, createServer } from 'http';
import { AddressInfo } from 'net';

import { SimpleFallbackJsonRpcBatchProvider } from '@lido-nestjs/execution';

import { USER_AGENT } from 'app/app.constants';
import { CriticalAlertsService } from 'common/alertmanager';
import { ConsensusProviderService } from 'common/consensus-provider';
import { executionProviderConfig } from 'common/execution-provider/execution-provider.config';
import { KeysapiSourceClient } from 'validators-registry/keysapi-source/keysapi-source.client';

/** Answers a JSON-RPC batch with a chain id and a block number, anything else with nothing. */
const jsonRpcReply = (body: string) => {
  const calls = body.startsWith('[') ? JSON.parse(body) : [];
  if (calls.length === 0) return undefined;
  return JSON.stringify(
    calls.map(({ id, method }: any) => ({ jsonrpc: '2.0', id, result: method === 'eth_blockNumber' ? '0x10' : '0x1' })),
  );
};

/** Every outgoing client, against a server that only remembers who asked. */
describe('User-Agent', () => {
  let server: Server;
  let url: string;
  let seen: (string | undefined)[];

  const fakes = (config: Record<string, unknown>) => ({
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    config: { get: (key: string) => config[key] },
    prometheus: {
      outgoingELRequestsDuration: { startTimer: jest.fn(() => jest.fn()) },
      outgoingELRequestsCount: { inc: jest.fn() },
      outgoingCLRequestsDuration: { startTimer: jest.fn(() => jest.fn()) },
      outgoingCLRequestsCount: { inc: jest.fn() },
      outgoingKeysAPIRequestsDuration: { startTimer: jest.fn(() => jest.fn()) },
      outgoingKeysAPIRequestsCount: { inc: jest.fn() },
      observeRpcRequest: jest.fn(),
    },
  });

  beforeEach(async () => {
    seen = [];
    server = createServer((req, res) => {
      seen.push(req.headers['user-agent']);
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(jsonRpcReply(body) ?? '{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => new Promise((resolve) => server.close(resolve)));

  test('it names the app and its version, rather than the HTTP library', () => {
    expect(USER_AGENT).toMatch(/^ethereum-validators-monitoring\/\S+$/);
  });

  test('the consensus client sends it', async () => {
    const { logger, config, prometheus } = fakes({
      CL_API_URLS: [url],
      WORKING_MODE: 'finalized',
      CL_API_MAX_SLOT_DEEP_COUNT: 32,
      CL_API_GET_RESPONSE_TIMEOUT: 5000,
    });
    const service = new ConsensusProviderService(logger as any, config as any, prometheus as any, {} as any, {} as any, {} as any);

    await (service as any).apiGet(url, '/eth/v1/node/version');

    expect(seen).toEqual([USER_AGENT]);
  });

  test('the Keys API client sends it', async () => {
    const { logger, config, prometheus } = fakes({
      VALIDATOR_REGISTRY_KEYSAPI_SOURCE_URLS: [url],
      VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RESPONSE_TIMEOUT: 5000,
    });
    const client = new KeysapiSourceClient(logger as any, config as any, prometheus as any);

    await (client as any).apiGet(url, 'v1/status');

    expect(seen).toEqual([USER_AGENT]);
  });

  test('the alert notifier sends it', async () => {
    const { logger, config, prometheus } = fakes({ CRITICAL_ALERTS_ALERTMANAGER_URL: url });
    const service = new CriticalAlertsService(logger as any, config as any, {} as any, prometheus as any, {} as any);

    // fire() does not return its promise — the alert is sent without anyone waiting for it.
    (service as any).fire({ labels: {} });
    while (seen.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));

    expect(seen).toEqual([USER_AGENT]);
  });

  test('the execution provider sends it', async () => {
    const { logger, prometheus } = fakes({});
    const provider = new SimpleFallbackJsonRpcBatchProvider(executionProviderConfig([url], 1, prometheus as any), logger as any);

    await expect(provider.getBlockNumber()).resolves.toBe(16);
    // The provider re-arms a fallback reset after network detection and has no teardown.
    clearTimeout((provider as any).resetTimer);

    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([USER_AGENT]));
  });
});
