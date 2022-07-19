const sql = `
CREATE TABLE IF NOT EXISTS stats.validators (
    "nos_id" String,
    "nos_name" String,
    "f_index" Int64,
    "pubkey" String,
    PRIMARY KEY (pubkey)
)
ENGINE = MergeTree()
`;

export default sql;
