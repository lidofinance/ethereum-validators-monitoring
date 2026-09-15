import { register } from 'prom-client';

import {
  PrometheusService,
  RpcLayer,
  TrackCLRequest,
  TrackKeysAPIRequest,
  normalizeProvider,
  responseCodeClass,
} from './prometheus.service';

describe('normalizeProvider', () => {
  test('a named endpoint is reduced to its last two labels, credentials and path gone', () => {
    expect(normalizeProvider('https://user:key@eth-mainnet.g.alchemy.com/v2/deadbeef')).toBe('alchemy.com');
    expect(normalizeProvider('https://rpc.example.com')).toBe('example.com');
    expect(normalizeProvider('https://example.com:8545')).toBe('example.com');
  });

  test('an address or an in-cluster name keeps its port, the only thing telling two apart', () => {
    expect(normalizeProvider('http://10.0.0.1:8545')).toBe('10.0.0.1:8545');
    expect(normalizeProvider('http://vroom-kapi-versioned-server:3000')).toBe('vroom-kapi-versioned-server:3000');
  });

  test('something that is not a URL does not break the label', () => {
    expect(normalizeProvider('not a url')).toBe('unknown');
  });
});

describe('responseCodeClass', () => {
  test('codes are aggregated, and no response leaves the label empty', () => {
    expect(responseCodeClass(200)).toBe('2xx');
    expect(responseCodeClass(503)).toBe('5xx');
    expect(responseCodeClass(undefined)).toBe('');
  });
});

describe('observeRpcRequest', () => {
  let service: PrometheusService;

  const labelsOf = async (name: string) => ((await register.getSingleMetric(name)?.get())?.values ?? []).map((value: any) => value.labels);

  beforeEach(() => {
    register.resetMetrics();
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const config = { get: (key: string) => (key === 'ETH_NETWORK' ? 1 : undefined) };
    service = new PrometheusService(logger as any, config as any);
  });

  test('the consensus layer reports all three families, unprefixed', async () => {
    service.observeRpcRequest({
      layer: RpcLayer.CL,
      url: 'https://user:key@cl.example.com/eth/v1',
      method: '/eth/v1/beacon/states/{param}/validators',
      batched: false,
      durationSeconds: 0.2,
      responseCode: 200,
    });

    expect(await labelsOf('http_rpc_requests_total')).toEqual([
      {
        network: 'ethereum',
        layer: 'cl',
        chain_id: 1,
        provider: 'example.com',
        batched: 'false',
        response_code: '2xx',
        result: 'success',
      },
    ]);
    expect(await labelsOf('rpc_request_total')).toEqual([
      expect.objectContaining({ method: '/eth/v1/beacon/states/{param}/validators', result: 'success', rpc_error_code: '' }),
    ]);
    expect(await labelsOf('http_rpc_response_seconds')).not.toHaveLength(0);
  });

  test('a batch without a method reports the HTTP families only', async () => {
    service.observeRpcRequest({ layer: RpcLayer.EL, url: 'http://el:8545', batched: true, durationSeconds: 1 });

    expect(await labelsOf('http_rpc_requests_total')).toEqual([
      expect.objectContaining({ layer: 'el', batched: 'true', response_code: '', result: 'fail' }),
    ]);
    expect(await labelsOf('rpc_request_total')).toHaveLength(0);
  });
});

describe('request tracking', () => {
  const track = (decorator: MethodDecorator, result: Promise<any>) => {
    const prometheus = {
      outgoingCLRequestsDuration: { startTimer: jest.fn(() => jest.fn()) },
      outgoingCLRequestsCount: { inc: jest.fn() },
      outgoingKeysAPIRequestsDuration: { startTimer: jest.fn(() => jest.fn()) },
      outgoingKeysAPIRequestsCount: { inc: jest.fn() },
      observeRpcRequest: jest.fn(),
    };
    const descriptor: PropertyDescriptor = { value: () => result };
    decorator({}, 'apiGet', descriptor);

    return { prometheus, call: () => descriptor.value.call({ prometheus }, 'http://host:5052', '/eth/v1/node/version') };
  };

  test('a consensus request is reported as blockchain RPC', async () => {
    const { prometheus, call } = track(TrackCLRequest as MethodDecorator, Promise.resolve('ok'));

    await call();

    expect(prometheus.observeRpcRequest).toHaveBeenCalledWith(
      expect.objectContaining({ layer: RpcLayer.CL, method: '/eth/v1/node/version', responseCode: 200 }),
    );
  });

  test('a Keys API request is not: it is our own HTTP service, not an RPC endpoint', async () => {
    const { prometheus, call } = track(TrackKeysAPIRequest as MethodDecorator, Promise.resolve('ok'));

    await call();

    expect(prometheus.observeRpcRequest).not.toHaveBeenCalled();
    expect(prometheus.outgoingKeysAPIRequestsCount.inc).toHaveBeenCalled();
  });
});
