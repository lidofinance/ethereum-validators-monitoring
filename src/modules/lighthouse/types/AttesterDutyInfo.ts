export interface AttesterDutyInfo {
  pubkey: string
  validator_index: string
  committee_index: string
  committee_length: string
  committees_at_slot: string
  validator_committee_index: string
  slot: string
  attested: boolean
  in_block: string | undefined
}

