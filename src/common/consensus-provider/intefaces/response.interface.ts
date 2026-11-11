import { RootHex, Slot } from 'common/types/types';

type BLSSignature = string;
type ValidatorIndex = string;

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
    parent_root: RootHex;
    body: {
      attestations: BeaconBlockAttestation[];
      sync_aggregate: {
        sync_committee_bits: string;
      };
      /**
       * Up to Fulu the block carries its execution payload inline. Since Gloas (EIP-7732) the payload is revealed by
       * the builder in a separate envelope and the body commits to `signed_execution_payload_bid` instead, so it is
       * absent from every post-fork block.
       */
      execution_payload?: {
        block_number: number;
        withdrawals: Withdrawal[];
      };
      /**
       * [New in Gloas:EIP7732]
       */
      signed_execution_payload_bid?: SignedExecutionPayloadBid;
    };
  };
}

/**
 * Commitment to an execution payload the proposer puts into the block since Gloas (EIP-7732).
 *
 * Only the field the app reads is modelled.
 */
export interface SignedExecutionPayloadBid {
  message: {
    /**
     * Hash of the execution layer block the state already has: `process_execution_payload_bid` asserts
     * `bid.parent_block_hash == state.latest_block_hash`, so it is the payload of the latest ancestor whose payload was
     * revealed in time and applied.
     */
    parent_block_hash: string;
    /**
     * Hash of the execution layer block the builder promises to reveal for this block. The next block tells whether
     * that happened in time: if its `parent_block_hash` is this hash, the payload was applied, and if it is an older
     * one, the payload was skipped.
     */
    block_hash: string;
  };
}

/**
 * Execution payload the builder reveals for a block since Gloas (EIP-7732).
 *
 * Only the field the app reads is modelled.
 */
export interface SignedExecutionPayloadEnvelope {
  message: {
    payload: {
      withdrawals: Withdrawal[];
    };
  };
}

export interface Withdrawal {
  index: string;
  validator_index: ValidatorIndex;
  address: string;
  amount: string;
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
  committee_bits?: string;
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

export interface SpecResponse {
  DENEB_FORK_EPOCH?: string;
  ELECTRA_FORK_EPOCH?: string;
  GLOAS_FORK_EPOCH?: string;
}
