const sql = `
CREATE TABLE IF NOT EXISTS stats.validator_balances (
    "validator_pubkey" String,
    "validator_id" String,
    "validator_slashed" UInt8,
    "status" String,
    "balance" Int64,
    "slot" Int64,
    "slot_time" DateTime,
    "nos_id" Nullable(UInt32),
    "nos_name" Nullable(String),
    INDEX nos_index (nos_name) TYPE set(0) GRANULARITY 8192,
    INDEX status_index (status) TYPE set(0) GRANULARITY 8192,
    INDEX slot_time_index (slot_time) TYPE minmax GRANULARITY 8192
)
ENGINE = MergeTree()
ORDER BY (slot, validator_pubkey)
PRIMARY KEY (slot, validator_pubkey)
TTL slot_time + INTERVAL 2 WEEK DELETE
`;

export default sql;
