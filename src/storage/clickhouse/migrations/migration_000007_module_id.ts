const sql = `
ALTER TABLE validators_summary
// state
ADD COLUMN IF NOT EXISTS val_nos_module_id Nullable(UInt32) AFTER val_id
`;

export default sql;
