const sql = `
    ALTER TABLE validators_summary
        ADD COLUMN IF NOT EXISTS block_proposals Array(Tuple(Int64, UInt8)) DEFAULT [] AFTER block_proposed
`;

export default sql;
