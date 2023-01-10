const sql = `
CREATE TABLE IF NOT EXISTS epochs_processing (
    "epoch" Int64,
    "is_stored" Nullable(UInt8),
    "is_calculated" Nullable(UInt8)
)
ENGINE = ReplacingMergeTree()
ORDER BY epoch
`;
export default sql;
