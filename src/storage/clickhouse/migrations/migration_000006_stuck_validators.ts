const sql = `
ALTER TABLE validators_summary
// state
ADD COLUMN IF NOT EXISTS val_stuck UInt8 DEFAULT 0 AFTER val_balance_withdrawn
`;

export default sql;
