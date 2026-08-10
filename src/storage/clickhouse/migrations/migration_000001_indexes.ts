const sql = (engine: string) => `
CREATE TABLE IF NOT EXISTS validators_index (
    "val_id" Int64,
    "val_pubkey" String
)
ENGINE = ${engine}
ORDER BY val_id
`;
export default sql;
