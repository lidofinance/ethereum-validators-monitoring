const sql = `
ALTER TABLE stats.validator_attestations
ADD COLUMN IF NOT EXISTS inclusion_delay Nullable(UInt8) AFTER attested,
ADD COLUMN IF NOT EXISTS valid_head Nullable(UInt8) AFTER inclusion_delay,
ADD COLUMN IF NOT EXISTS valid_target Nullable(UInt8) AFTER valid_head,
ADD COLUMN IF NOT EXISTS valid_source Nullable(UInt8) AFTER valid_target
`;

export default sql;
