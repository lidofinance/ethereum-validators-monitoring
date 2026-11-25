import { ClickhouseService } from './clickhouse.service';

const TTL_21 = 'toDateTime(1606824023 + (epoch * 384)) + toIntervalDay(21)';

const makeService = (days: number, engine: string) => {
  const config: Record<string, unknown> = {
    DB_MAX_RETRIES: 0,
    DB_MIN_BACKOFF_SEC: 0,
    DB_MAX_BACKOFF_SEC: 0,
    DB_HOST: 'http://localhost',
    DB_PORT: '8123',
    DB_SUMMARY_TTL_DAYS: days,
    CHAIN_SLOT_TIME_SECONDS: 12,
    FETCH_INTERVAL_SLOTS: 32,
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new ClickhouseService(logger as any, { get: (key: string) => config[key] } as any, {} as any);
  const selects: string[] = [];
  const alters: string[] = [];
  (service as any).db = {
    // The server's formatting of the expected TTL, as formatQuerySingleLine returns it.
    query: jest.fn(async ({ query }: { query: string }) => {
      selects.push(query);
      return { json: async () => [{ expected: TTL_21, engine }] };
    }),
    exec: jest.fn(async ({ query }: { query: string }) => {
      alters.push(query.trim());
    }),
  };
  return { service, selects, alters };
};

describe('ClickhouseService.applySummaryTtl', () => {
  it('leaves the table alone when no TTL is configured', async () => {
    const { service, selects, alters } = makeService(0, 'ReplacingMergeTree ORDER BY (epoch, val_id)');

    await service.applySummaryTtl(1606824023);

    expect(selects).toEqual([]);
    expect(alters).toEqual([]);
  });

  it('sets the drop-parts setting and the TTL on a table that has neither', async () => {
    const { service, selects, alters } = makeService(
      21,
      'ReplicatedReplacingMergeTree PARTITION BY intDiv(epoch, 225) ORDER BY (epoch, val_id) SETTINGS index_granularity = 8192',
    );

    await service.applySummaryTtl(1606824023);

    expect(selects[0]).toContain("formatQuerySingleLine('SELECT toDateTime(1606824023 + epoch * 384) + toIntervalDay(21)')");
    expect(alters).toEqual([
      'ALTER TABLE validators_summary MODIFY SETTING ttl_only_drop_parts = 1',
      'ALTER TABLE validators_summary MODIFY TTL toDateTime(1606824023 + epoch * 384) + toIntervalDay(21)',
    ]);
  });

  it('does nothing when the table already has this TTL, so a restart does not recalculate it', async () => {
    const { service, alters } = makeService(
      21,
      `ReplacingMergeTree ORDER BY (epoch, val_id) TTL ${TTL_21} SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1`,
    );

    await service.applySummaryTtl(1606824023);

    expect(alters).toEqual([]);
  });

  it('replaces a different TTL', async () => {
    const { service, alters } = makeService(
      21,
      'ReplacingMergeTree ORDER BY (epoch, val_id) TTL toDateTime(1606824023 + (epoch * 384)) + toIntervalDay(14) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1',
    );

    await service.applySummaryTtl(1606824023);

    expect(alters).toEqual(['ALTER TABLE validators_summary MODIFY TTL toDateTime(1606824023 + epoch * 384) + toIntervalDay(21)']);
  });
});
