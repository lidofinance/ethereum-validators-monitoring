import { Readable } from 'stream';

import { ClickhouseService } from './clickhouse.service';

type Rows = Record<string, any[]>;

const validator = (val_id: number) => ({
  epoch: 1,
  val_id,
  val_pubkey: `0x${val_id}`,
  val_balance: 32n,
  val_effective_balance: 32n,
});

const makeService = (stored: { rows: number; max: number }, failOn?: string) => {
  const inserted: Rows = {};
  const db = {
    query: jest.fn(async () => ({ json: async () => [{ rows: String(stored.rows), max: String(stored.max) }] })),
    insert: jest.fn(async ({ table, values }: { table: string; values: Readable }) => {
      const rows = [];
      for await (const row of values) rows.push(row);
      if (table === failOn) throw new Error(`insert into ${table} failed`);
      inserted[table] = (inserted[table] ?? []).concat(rows);
    }),
  };
  const service = Object.assign(Object.create(ClickhouseService.prototype), {
    db,
    retry: (fn: () => Promise<any>) => fn(),
    logger: { debug: jest.fn(), error: jest.fn() },
    prometheus: { taskDuration: { startTimer: () => () => 0 }, taskCount: { inc: jest.fn() } },
  }) as ClickhouseService;
  return { service, db, inserted };
};

const ids = (rows: any[]) => rows.map((r) => r.val_id);

describe('ClickhouseService.writeSummary', () => {
  it('writes every index into an empty table, then only the new ones', async () => {
    const { service, db, inserted } = makeService({ rows: 0, max: 0 });

    await service.writeSummary([0, 1, 2].map(validator).values());
    expect(ids(inserted.validators_index)).toEqual([0, 1, 2]);

    await service.writeSummary([0, 1, 2, 3].map(validator).values());
    expect(ids(inserted.validators_index)).toEqual([0, 1, 2, 3]);
    // The stored maximum is read once, not per epoch
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('skips indexes the table already holds but writes the whole summary', async () => {
    const { service, inserted } = makeService({ rows: 3, max: 2 });

    await service.writeSummary([0, 1, 2, 3, 4].map(validator).values());

    expect(ids(inserted.validators_index)).toEqual([3, 4]);
    expect(inserted.validators_index[0]).toEqual({ val_id: 3, val_pubkey: '0x3' });
    expect(ids(inserted.validators_summary)).toEqual([0, 1, 2, 3, 4]);
  });

  it('writes the same indexes again after a failed epoch', async () => {
    const { service, db, inserted } = makeService({ rows: 1, max: 0 }, 'validators_index');

    await expect(service.writeSummary([0, 1, 2].map(validator).values())).rejects.toThrow();

    db.insert.mockImplementation(async ({ table, values }: { table: string; values: Readable }) => {
      const rows = [];
      for await (const row of values) rows.push(row);
      inserted[table] = (inserted[table] ?? []).concat(rows);
    });
    await service.writeSummary([0, 1, 2].map(validator).values());

    expect(ids(inserted.validators_index)).toEqual([1, 2]);
  });
});
