export interface SyncCommitteeDutyInfo {
  pubkey: string
  validator_index: string,
  validator_sync_committee_indices: string[],
  results: BlockSyncResult[]
}

export interface BlockSyncResult {
  block: string,
  sync: boolean
}
