export interface ValidatorsStatusStats {
  active_ongoing: number;
  pending: number;
  slashed: number;
}

export interface NOsDelta {
  val_nos_name: string;
  delta: number;
}

export interface NOsValidatorsNegDeltaCount {
  val_nos_name: string;
  neg_count: number;
}

export interface NOsValidatorsSyncAvgPercent {
  val_nos_name: string;
  avg_percent: number;
}

export interface NOsValidatorsSyncLessChainAvgCount {
  val_nos_name: string;
  less_chain_avg_count: number;
}

export interface NOsValidatorsByConditionAttestationCount {
  val_nos_name: string;
  amount: number;
}

export interface NOsValidatorsMissProposeCount {
  val_nos_name: string;
  miss_propose_count: number;
}

export interface ValidatorIdentifications {
  validator_id: string;
  validator_pubkey: string;
}

export interface NOsValidatorsStatusStats extends ValidatorsStatusStats {
  val_nos_name: string;
}

export interface NOsProposesStats {
  val_nos_name: string;
  all: number;
  missed: number;
}

export interface SyncCommitteeParticipationAvgPercents {
  avg_percent: number;
}
