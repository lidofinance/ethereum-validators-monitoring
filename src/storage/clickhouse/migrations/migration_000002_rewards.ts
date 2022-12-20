const sql = `
ALTER TABLE stats.validators_summary
// state
ADD COLUMN IF NOT EXISTS val_effective_balance Nullable(UInt64) AFTER val_balance,
// att
ADD COLUMN IF NOT EXISTS att_earned_reward Nullable(UInt64) AFTER att_valid_source,
ADD COLUMN IF NOT EXISTS att_missed_reward Nullable(UInt64) AFTER att_earned_reward,
ADD COLUMN IF NOT EXISTS att_penalty Nullable(UInt64) AFTER att_missed_reward,
// sync
ADD COLUMN IF NOT EXISTS sync_earned_reward Nullable(UInt64) AFTER sync_percent,
ADD COLUMN IF NOT EXISTS sync_missed_reward Nullable(UInt64) AFTER sync_earned_reward,
ADD COLUMN IF NOT EXISTS sync_penalty Nullable(UInt64) AFTER sync_missed_reward,
// propose
ADD COLUMN IF NOT EXISTS propose_earned_reward Nullable(UInt64) AFTER block_to_propose,
ADD COLUMN IF NOT EXISTS propose_missed_reward Nullable(UInt64) AFTER propose_earned_reward,
ADD COLUMN IF NOT EXISTS propose_penalty Nullable(UInt64) AFTER propose_missed_reward
`;

export default sql;
