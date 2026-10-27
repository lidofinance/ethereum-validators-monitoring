const sql = `
ALTER TABLE validators_summary
// whether the execution payload of the proposed block was applied, empty slots since Gloas (EIP-7732) have it at 0
ADD COLUMN IF NOT EXISTS block_payload_applied Nullable(UInt8) AFTER block_proposed
`;

export default sql;
