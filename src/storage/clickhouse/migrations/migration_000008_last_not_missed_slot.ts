const sql = `
ALTER TABLE epochs_metadata
// latest proposed slot for the current epoch
ADD COLUMN IF NOT EXISTS last_not_missed_slot Nullable(UInt64) AFTER epoch
`;

export default sql;
