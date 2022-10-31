const sql = `
CREATE TABLE IF NOT EXISTS stats.validators_index (
    "val_id" Int64,
    "val_pubkey" String
)
ENGINE = ReplacingMergeTree()
ORDER BY val_id
`;
export default sql;
