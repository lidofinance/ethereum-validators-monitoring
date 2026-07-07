import { Epoch } from 'common/types/types';

export interface ValidatorsStatusBaseStats {
  active_ongoing: number;
  active_ongoing_balance: bigint;
  pending: number;
  pending_balance: bigint;
  slashed: number;
  slashed_balance: bigint;
  withdraw_pending: number;
  withdraw_pending_balance: bigint;
  withdrawn: number;
  withdrawn_balance: bigint;
}

export interface ModuleValidatorsStatusStats extends ValidatorsStatusBaseStats {
  val_nos_module_id: string;
  stuck: number;
  stuck_balance: bigint;
}

export interface NOsValidatorsStatusStats extends ModuleValidatorsStatusStats {
  val_nos_id: string;
}

export interface NOsIdentity {
  val_nos_module_id: string;
  val_nos_id: string | null;
}

export interface NOsValidatorsCount extends NOsIdentity {
  amount: number;
}

export interface NOsValidatorsCountAndBalance extends NOsValidatorsCount {
  balance: bigint;
}

export interface UserNOsIdentity {
  val_nos_module_id: string;
  val_nos_id: string;
}

export interface UserNOsValidatorsCount extends UserNOsIdentity {
  amount: number;
}

export interface UserNOsValidatorsCountAndBalance extends UserNOsValidatorsCount {
  balance: bigint;
}

export interface OtherValidatorsCountAndBalance {
  amount: number;
  balance: bigint;
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
