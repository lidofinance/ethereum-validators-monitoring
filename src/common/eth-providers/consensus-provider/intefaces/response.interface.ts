import { BLSSignature, RootHex, Slot, ValidatorIndex } from '../types';

export enum ValStatus {
  ActiveOngoing = 'active_ongoing',
  ActiveExiting = 'active_exiting',
  PendingQueued = 'pending_queued',
  PendingInitialized = 'pending_initialized',
  ActiveSlashed = 'active_slashed',
  ExitedSlashed = 'exited_slashed',
  ExitedUnslashed = 'exited_unslashed',
  WithdrawalPossible = 'withdrawal_possible',
  WithdrawalDone = 'withdrawal_done',
}

export interface AttesterDutyInfo {
  pubkey: string;
  validator_index: string;
  committee_index: string;
  committee_length: string;
  committees_at_slot: string;
  validator_committee_index: string;
  slot: string;
}

export interface CheckedAttesterDutyInfo extends AttesterDutyInfo {
  attested: boolean;
  valid_head: boolean;
  valid_target: boolean;
  valid_source: boolean;
  inclusion_delay: number;
  in_block: string | undefined;
}

export interface BlockHeaderResponse {
  root: RootHex;
  canonical: boolean;
  header: {
    message: {
      slot: Slot;
      proposer_index: ValidatorIndex;
      parent_root: RootHex;
      state_root: RootHex;
      body_root: RootHex;
    };
    signature: BLSSignature;
  };
}

export interface BlockInfoResponse {
  message: {
    slot: string;
    proposer_index: ValidatorIndex;
    body: {
      attestations: BeaconBlockAttestation[];
      sync_aggregate: {
        sync_committee_bits: string;
      };
      execution_payload: {
        withdrawals: Withdrawal[];
      };
    };
  };
}

export interface Withdrawal {
  index: string;
  validator_index: ValidatorIndex;
  address: string;
  amount: string;
}

export interface FinalityCheckpointsResponse {
  previous_justified: {
    epoch: string;
    root: RootHex;
  };
  current_justified: {
    epoch: string;
    root: RootHex;
  };
  finalized: {
    epoch: string;
    root: RootHex;
  };
}

export interface GenesisResponse {
  /**
   * example: 1590832934
   * The genesis_time configured for the beacon node, which is the unix time in seconds at which the Eth2.0 chain began.
   */
  genesis_time: string;

  /**
   * example: 0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2
   * pattern: ^0x[a-fA-F0-9]{64}$
   */
  genesis_validators_root: string;

  /**
   * example: 0x00000000
   * pattern: ^0x[a-fA-F0-9]{8}$
   * a fork version number
   */
  genesis_fork_version: string;
}

export interface ProposerDutyInfo {
  pubkey: string;
  validator_index: ValidatorIndex;
  slot: string;
  proposed: boolean;
}

export interface BeaconBlockAttestation {
  aggregation_bits: string;
  data: {
    slot: string;
    index: string;
    beacon_block_root: RootHex;
    source: {
      epoch: string;
      root: RootHex;
    };
    target: {
      epoch: string;
      root: RootHex;
    };
  };
}

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

export interface SyncCommitteeDutyInfo {
  pubkey: string;
  validator_index: ValidatorIndex;
  validator_sync_committee_indices: string[];
  results: {
    block: string;
    sync: boolean;
  }[];
}

export interface SyncCommitteeInfo {
  validators: ValidatorIndex[];
}

export interface AttestationCommitteeInfo {
  index: string;
  slot: string;
  validators: string[];
}

export interface SyncCommitteeValidator {
  in_committee_index: number;
  validator_index: ValidatorIndex;
  epoch_participation_percent: number;
}

export interface VersionResponse {
  version: string;
}
