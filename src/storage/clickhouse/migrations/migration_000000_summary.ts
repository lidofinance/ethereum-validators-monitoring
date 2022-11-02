const sql = `
CREATE TABLE IF NOT EXISTS stats.validators_summary (
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
`;
// todo: TTL epoch_time + INTERVAL 1 YEAR DELETE
export default sql;
