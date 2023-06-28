const sql = `
ALTER TABLE validators_summary
// state
ADD COLUMN IF NOT EXISTS val_nos_module_id UInt32 DEFAULT 1 AFTER val_id
`;

export default sql;
