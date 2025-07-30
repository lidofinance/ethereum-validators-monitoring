import { Epoch } from 'common/consensus-provider/types';

export interface ValidatorsStatusStats {
  val_nos_module_id?: string;
  active_ongoing: number;
  pending: number;
  slashed: number;
  withdraw_pending: number;
  withdrawn: number;
  stuck?: number;
}

export interface NOsDelta {
  val_nos_module_id: string;
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsNegDeltaCount {
  val_nos_module_id: string;
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsSyncAvgPercent {
  val_nos_module_id: string;
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsSyncByConditionCount {
  val_nos_module_id: string;
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsByConditionAttestationCount {
  val_nos_module_id: string;
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsByConditionProposeCount {
  val_nos_module_id: string;
  val_nos_id: string;
  amount: number;
}

export interface NOsBalance24hDiff {
  val_nos_module_id: string;
  val_nos_id: string;
  amount: number;
}

export interface NOsValidatorsStatusStats extends ValidatorsStatusStats {
  val_nos_id: string;
}

export interface NOsValidatorsRewardsStats {
  val_nos_module_id: string;
  val_nos_id: string;
  prop_reward: number;
  prop_missed: number;
  prop_penalty: number;
  sync_reward: number;
  sync_missed: number;
  sync_penalty: number;
  att_reward: number;
  att_missed: number;
  att_penalty: number;
  total_reward: number;
  total_missed: number;
  total_penalty: number;
  calculated_balance_change: number;
  real_balance_change: number;
  calculation_error: number;
}

export interface AvgChainRewardsStats {
  prop_reward: number;
  prop_missed: number;
  prop_penalty: number;
  sync_reward: number;
  sync_missed: number;
  sync_penalty: number;
  att_reward: number;
  att_missed: number;
  att_penalty: number;
}

export interface NOsProposesStats {
  val_nos_module_id: string;
  val_nos_id: string;
  all: number;
  missed: number;
}

export interface SyncCommitteeParticipationAvgPercents {
  val_nos_module_id?: string;
  amount: number;
}

export interface EpochProcessingState {
  epoch: Epoch;
  is_stored?: boolean;
  is_calculated?: boolean;
}

export interface WithdrawalsStats {
  full_withdrawn_sum: number;
  full_withdrawn_count: number;
  partial_withdrawn_sum: number;
  partial_withdrawn_count: number;
}
export interface NOsWithdrawalsStats extends WithdrawalsStats {
  val_nos_module_id: string;
  val_nos_id: string;
}
