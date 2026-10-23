import migration_000000_summary from './migration_000000_summary';
import migration_000001_indexes from './migration_000001_indexes';
import migration_000002_rewards from './migration_000002_rewards';
import migration_000003_epoch_meta from './migration_000003_epoch_meta';
import migration_000004_epoch_processing from './migration_000004_epoch_processing';
import migration_000005_withdrawals from './migration_000005_withdrawals';
import migration_000006_stuck_validators from './migration_000006_stuck_validators';
import migration_000007_module_id from './migration_000007_module_id';
import migration_000008_last_not_missed_slot from './migration_000008_last_not_missed_slot';
import migration_000009_pending_consolidations from './migration_000009_pending_consolidations';
import migration_000010_block_payload from './migration_000010_block_payload';

const PLAIN_ENGINE = 'ReplacingMergeTree()';
const REPLICATED_ENGINE = 'ReplicatedReplacingMergeTree()';

const builders: Record<string, (engine: string) => string> = {
  migration_000000_summary,
  migration_000001_indexes,
  migration_000003_epoch_meta,
  migration_000004_epoch_processing,
  migration_000009_pending_consolidations,
};

const plainMigrations: Record<string, string> = {
  migration_000002_rewards,
  migration_000005_withdrawals,
  migration_000006_stuck_validators,
  migration_000007_module_id,
  migration_000008_last_not_missed_slot,
  migration_000010_block_payload,
};

/**
 * Verbatim SQL of every engine-parameterized migration, as it was before the engine became configurable.
 * These fixtures pin the default (non-replicated) output byte for byte.
 */
const expectedPlainSql: Record<string, string> = {
  migration_000000_summary: `
CREATE TABLE IF NOT EXISTS validators_summary (
    "epoch" Int64,
    "val_id" Int64,
    "val_nos_id" Nullable(UInt32),
    "val_nos_name" Nullable(String),
    "val_slashed" UInt8,
    "val_status" String,
    "val_balance" Int64,
    "is_proposer" UInt8,
    "block_to_propose" Nullable(Int64),
    "block_proposed" Nullable(UInt8),
    "is_sync" UInt8,
    "sync_percent" Nullable(Float32),
    "att_happened" Nullable(UInt8),
    "att_inc_delay" Nullable(UInt8),
    "att_valid_head" Nullable(UInt8),
    "att_valid_target" Nullable(UInt8),
    "att_valid_source" Nullable(UInt8),
    INDEX epoch_index (epoch) TYPE minmax GRANULARITY 8192,
    INDEX nos_id_index (val_nos_id) TYPE set(0) GRANULARITY 8192,
    INDEX nos_name_index (val_nos_name) TYPE set(0) GRANULARITY 8192,
    INDEX status_index (val_status) TYPE set(9) GRANULARITY 8192,
    INDEX delay_index (att_inc_delay) TYPE minmax GRANULARITY 8192,
    INDEX att_index (att_happened) TYPE set(2) GRANULARITY 8192,
    INDEX proposer_index (is_proposer) TYPE set(2) GRANULARITY 8192,
    INDEX sync_index (is_sync) TYPE set(2) GRANULARITY 8192
)
ENGINE = ReplacingMergeTree()
ORDER BY (epoch, val_id)
PARTITION BY intDiv(epoch, 225)
`,
  migration_000001_indexes: `
CREATE TABLE IF NOT EXISTS validators_index (
    "val_id" Int64,
    "val_pubkey" String
)
ENGINE = ReplacingMergeTree()
ORDER BY val_id
`,
  migration_000003_epoch_meta: `
CREATE TABLE IF NOT EXISTS epochs_metadata (
    "epoch" Int64,
    "active_validators" UInt32,
    "active_validators_total_increments" Int64,
    "base_reward" UInt32,
    "att_blocks_rewards" Array(Array(Int64)),
    "att_source_participation" Int64,
    "att_target_participation" Int64,
    "att_head_participation" Int64,
    "sync_blocks_rewards" Array(Array(Int64)),
    "sync_blocks_to_sync" Array(Int64),
    INDEX epoch_index (epoch) TYPE minmax GRANULARITY 8192
)
ENGINE = ReplacingMergeTree()
ORDER BY epoch
`,
  migration_000004_epoch_processing: `
CREATE TABLE IF NOT EXISTS epochs_processing (
    "epoch" Int64,
    "is_stored" Nullable(UInt8),
    "is_calculated" Nullable(UInt8)
)
ENGINE = ReplacingMergeTree()
ORDER BY epoch
`,
  migration_000009_pending_consolidations: `
CREATE TABLE IF NOT EXISTS pending_consolidations (
    "epoch" Int64,
    "source_val_id" Int64,
    "target_val_id" Int64
)
ENGINE = ReplacingMergeTree()
ORDER BY (epoch, source_val_id, target_val_id)
`,
};

const structuralClausesOf = (sql: string): string[] =>
  sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(ORDER BY|PARTITION BY|INDEX |TTL )/.test(line));

describe('clickhouse migrations', () => {
  describe('default (non-replicated) engine', () => {
    it.each(Object.keys(builders))('%s reproduces the original SQL byte for byte', (name) => {
      expect(builders[name](PLAIN_ENGINE)).toBe(expectedPlainSql[name]);
    });
  });

  describe('replicated engine', () => {
    it.each(Object.keys(builders))('%s uses ReplicatedReplacingMergeTree()', (name) => {
      const sql = builders[name](REPLICATED_ENGINE);

      expect(sql).toContain(`ENGINE = ${REPLICATED_ENGINE}`);
      expect(sql).not.toContain(`ENGINE = ${PLAIN_ENGINE}`);
    });

    it.each(Object.keys(builders))('%s differs from the default output only in the engine clause', (name) => {
      const sql = builders[name](REPLICATED_ENGINE);

      expect(sql.replace(`ENGINE = ${REPLICATED_ENGINE}`, `ENGINE = ${PLAIN_ENGINE}`)).toBe(expectedPlainSql[name]);
    });

    it.each(Object.keys(builders))('%s keeps ORDER BY / PARTITION BY / INDEX definitions intact', (name) => {
      expect(structuralClausesOf(builders[name](REPLICATED_ENGINE))).toEqual(structuralClausesOf(expectedPlainSql[name]));
    });
  });

  describe('ALTER-only migrations', () => {
    it.each(Object.keys(plainMigrations))('%s stays a plain string', (name) => {
      expect(typeof plainMigrations[name]).toBe('string');
    });
  });
});
