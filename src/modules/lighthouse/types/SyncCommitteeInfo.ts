export interface SyncCommitteeInfo {
  validators: string[]
}

export interface SyncCommitteeValidator {
  in_committee_index: number
  validator_index: string
  epoch_participation_percent: number
}
