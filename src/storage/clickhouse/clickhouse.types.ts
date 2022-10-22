import { CheckedAttesterDutyInfo } from 'common/eth-providers';

export interface ValidatorsStatusStats {
  active_ongoing: number;
  pending: number;
  slashed: number;
}

export interface NOsDelta {
  nos_name: string;
  delta: number;
}

export interface NOsValidatorsNegDeltaCount {
  nos_name: string;
  neg_count: number;
}

export interface NOsValidatorsSyncAvgPercent {
  nos_name: string;
  avg_percent: number;
}

export interface NOsValidatorsSyncLessChainAvgCount {
  nos_name: string;
  less_chain_avg_count: number;
}

export interface NOsValidatorsByConditionAttestationCount {
  nos_name: string;
  amount: number;
}

export interface NOsValidatorsMissProposeCount {
  nos_name: string;
  miss_propose_count: number;
}

export interface ValidatorIdentifications {
  validator_id: string;
  validator_pubkey: string;
}

export interface NOsValidatorsStatusStats extends ValidatorsStatusStats {
  nos_name: string;
}

export interface NOsProposesStats {
  nos_name: string;
  all: number;
  missed: number;
}

export interface SlotAttestation {
  bits: boolean[];
  head: string;
  target: string;
  source: string;
  slot: string;
  committee_index: string;
}

export interface CheckAttestersDutyResult {
  attestersDutyInfo: CheckedAttesterDutyInfo[];
  blocksAttestations: { [blockNum: string]: SlotAttestation[] };
  allMissedSlots: string[];
}

export interface SyncCommitteeParticipationAvgPercents {
  avg_percent: number;
}
