const sql = `
ALTER TABLE validators_summary
// state
ADD COLUMN IF NOT EXISTS val_balance_withdrawn Nullable(UInt64) AFTER val_balance
`;

export default sql;
