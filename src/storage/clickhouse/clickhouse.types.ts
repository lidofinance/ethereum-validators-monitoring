export interface ValidatorsStatusStats {
  active_ongoing: number;
  pending: number;
  slashed: number;
}

export interface NOsDelta {
  val_nos_id: string;
  delta: number;
}

export interface NOsValidatorsNegDeltaCount {
  val_nos_id: string;
  neg_count: number;
}

export interface NOsValidatorsSyncAvgPercent {
  val_nos_id: string;
  avg_percent: number;
}

export interface NOsValidatorsSyncByConditionCount {
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsByConditionAttestationCount {
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsByConditionProposeCount {
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsStatusStats extends ValidatorsStatusStats {
  val_nos_id: string;
}

export interface NOsProposesStats {
  val_nos_id: string;
  all: number;
  missed: number;
}

export interface SyncCommitteeParticipationAvgPercents {
  avg_percent: number;
}
