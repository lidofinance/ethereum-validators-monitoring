const sql = `
CREATE TABLE IF NOT EXISTS stats.validator_sync (
    "start_fetch_time" DateTime,
    "validator_pubkey" String,
    "validator_id" String,
    "last_slot_of_epoch" UInt64,
    "epoch_participation_percent" Float32,
    "epoch_chain_participation_percent_avg" Float32,
    "nos_id" Nullable(UInt32),
    "nos_name" Nullable(String),
    INDEX nos_index (nos_name) TYPE set(0) GRANULARITY 8192,
    INDEX start_fetch_time_index (start_fetch_time) TYPE minmax GRANULARITY 8192
)
ENGINE = MergeTree()
ORDER BY (start_fetch_time, last_slot_of_epoch, validator_pubkey)
PRIMARY KEY (start_fetch_time, last_slot_of_epoch, validator_pubkey)
TTL start_fetch_time + INTERVAL 2 WEEK DELETE
`;

export default sql;
