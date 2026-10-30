import { register } from 'prom-client';

import { PrometheusService } from 'common/prometheus';

import { createExecutionFetchMiddleware } from './execution-provider.middleware';

const labelsOf = async (name: string) => ((await register.getSingleMetric(name)?.get())?.values ?? []).map((value: any) => value.labels);

const prometheusService = () => {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const config = { get: (key: string) => (key === 'ETH_NETWORK' ? 1 : undefined) };
  return new PrometheusService(logger as any, config as any);
};

describe('createExecutionFetchMiddleware', () => {
  const middleware = createExecutionFetchMiddleware(prometheusService());
  // Frozen like the real one: ethers freezes the connection when it builds the provider.
  const ctxFor = (url: string) => ({ provider: { connection: Object.freeze({ url }) } });

  beforeEach(() => register.resetMetrics());

  test('a successful batch is counted as 2xx', async () => {
    await expect(middleware(async () => ['ok'], ctxFor('https://eth-mainnet.g.alchemy.com/v2/key'))).resolves.toEqual(['ok']);

    expect(await labelsOf('http_rpc_requests_total')).toEqual([
      {
        network: 'ethereum',
        layer: 'el',
        chain_id: 1,
        provider: 'alchemy.com',
        batched: 'true',
        response_code: '2xx',
        result: 'success',
      },
    ]);
  });

  test('a server error keeps the error and is counted under its status class', async () => {
    const failing = middleware(async () => {
      throw Object.assign(new Error('bad response'), { status: 502 });
    }, ctxFor('https://lb.drpc.org/ogrpc?network=ethereum'));

    await expect(failing).rejects.toThrow('bad response');
    expect((await labelsOf('http_rpc_requests_total'))[0]).toMatchObject({ response_code: '5xx', result: 'fail' });
  });
});
