import { ClickhouseService } from './clickhouse.service';

describe('ClickhouseService.ping', () => {
  const build = (query: jest.Mock) => {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const config = {
      get: (key: string) => {
        if (key === 'DB_MAX_RETRIES') return 10;
        if (key === 'DB_MIN_BACKOFF_SEC') return 1;
        if (key === 'DB_MAX_BACKOFF_SEC') return 120;
        if (key === 'DB_HOST') return 'http://localhost';
        if (key === 'DB_PORT') return '8123';
        return 'value';
      },
    };
    const service = new ClickhouseService(logger as any, config as any, {} as any);
    (service as any).db = { query };
    return service;
  };

  test('it asks once and gives up, rather than backing off for minutes like the indexer does', async () => {
    const query = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const service = build(query);

    await expect(service.ping()).rejects.toThrow('ECONNREFUSED');
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('the query carries a timeout of its own, since the client default is five minutes', async () => {
    const query = jest.fn().mockResolvedValue({ text: async () => '1' });
    const service = build(query);

    await service.ping();

    const [params] = query.mock.calls[0];
    expect(params.query).toBe('SELECT 1');
    expect(params.abort_signal).toBeInstanceOf(AbortSignal);
  });
});
