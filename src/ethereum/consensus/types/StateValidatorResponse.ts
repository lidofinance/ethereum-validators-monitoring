import { ValStatus } from './ValidatorStatus';

export interface StateValidatorResponse {
  index: string;
  balance: string;
  status: typeof ValStatus[keyof typeof ValStatus];
  validator: {
    pubkey: string;
    withdrawal_credentials: string;
    effective_balance: string;
    slashed: boolean;
    activation_eligibility_epoch: string;
    activation_epoch: string;
    exit_epoch: string;
    withdrawable_epoch: string;
  };
}
