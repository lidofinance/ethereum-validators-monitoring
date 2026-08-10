const sql = (engine: string) => `
CREATE TABLE IF NOT EXISTS pending_consolidations (
    "epoch" Int64,
    "source_val_id" Int64,
    "target_val_id" Int64
)
ENGINE = ${engine}
ORDER BY (epoch, source_val_id, target_val_id)
`;
export default sql;
