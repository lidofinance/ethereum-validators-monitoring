const sql = `
CREATE TABLE IF NOT EXISTS epochs_metadata (
    "epoch" Int64,
    "active_validators" UInt32,
    "active_validators_total_increments" Int64,
    "base_reward" UInt32,
    "att_blocks_rewards" Array(Array(Int64)),
    "att_correct_source" UInt32,
    "att_correct_target" UInt32,
    "att_correct_head" UInt32,
    "sync_blocks_rewards" Array(Array(Int64)),
    "sync_blocks_to_sync" Array(Int64),
    INDEX epoch_index (epoch) TYPE minmax GRANULARITY 8192
)
ENGINE = ReplacingMergeTree()
ORDER BY epoch
`;
export default sql;
