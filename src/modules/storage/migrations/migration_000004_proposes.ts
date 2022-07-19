const sql = `
CREATE TABLE IF NOT EXISTS stats.validator_proposes (
    "start_fetch_time" DateTime,
    "validator_pubkey" String,
    "validator_id" String,
    "slot_to_propose" UInt64,
    "proposed" UInt8,
    "nos_id" Nullable(UInt32),
    "nos_name" Nullable(String),
    INDEX nos_index (nos_name) TYPE set(0) GRANULARITY 8192,
    INDEX start_fetch_time_index (start_fetch_time) TYPE minmax GRANULARITY 8192
)
ENGINE = MergeTree()
ORDER BY (start_fetch_time, slot_to_propose, validator_pubkey)
PRIMARY KEY (start_fetch_time, slot_to_propose, validator_pubkey)
TTL start_fetch_time + INTERVAL 2 WEEK DELETE
`;

export default sql;
