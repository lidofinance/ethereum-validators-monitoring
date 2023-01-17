import { Injectable } from '@nestjs/common';
import { merge } from 'lodash';

import { ValStatus } from 'common/eth-providers';
import { Epoch } from 'common/eth-providers/consensus-provider/types';

type BlockNumber = number;
type ValidatorId = number;

interface ValidatorAttestationReward {
  source: number;
  target: number;
  head: number;
}

interface ValidatorAttestationPenalty extends ValidatorAttestationReward {}

export interface ValidatorDutySummary {
  epoch: Epoch;
  ///
  val_id: number;
  val_pubkey?: string;
  val_nos_id?: number;
  val_nos_name?: string;
  val_slashed?: boolean;
  val_status?: ValStatus;
  val_balance?: bigint;
  val_effective_balance?: bigint;
  ///
  is_proposer?: boolean;
  block_to_propose?: number;
  block_proposed?: boolean;
  ///
  is_sync?: boolean;
  sync_percent?: number;
  ///
  att_happened?: boolean;
  att_inc_delay?: number;
  att_valid_head?: boolean;
  att_valid_target?: boolean;
  att_valid_source?: boolean;
  // Metadata. Necessary for calculating rewards and will not be stored in DB
  sync_meta?: {
    synced_blocks?: number[];
  };
  att_meta?: Map<
    BlockNumber,
    {
      timely_source?: boolean;
      timely_target?: boolean;
      timely_head?: boolean;
    }
  >;
  // Rewards
  att_earned_reward?: number;
  att_missed_reward?: number;
  att_penalty?: number;
  sync_earned_reward?: number;
  sync_missed_reward?: number;
  sync_penalty?: number;
  propose_earned_reward?: bigint;
  propose_missed_reward?: bigint;
  propose_penalty?: bigint;
}

export interface EpochMeta {
  // will be stored in DB in separate table
  state?: {
    active_validators?: number;
    active_validators_total_increments?: bigint;
    base_reward?: number;
  };
  attestation?: {
    participation?: { source: bigint; target: bigint; head: bigint };
    blocks_rewards?: Map<BlockNumber, bigint>;
  };
  sync?: {
    blocks_rewards?: Map<BlockNumber, bigint>;
    per_block_reward?: number;
    blocks_to_sync?: number[];
  };
}

export interface EpochInfo {
  summary: Map<ValidatorId, ValidatorDutySummary>;
  meta: EpochMeta;
}

export type EpochStorage = Map<Epoch, EpochInfo>;

@Injectable()
export class SummaryService {
  protected storage: EpochStorage;

  constructor() {
    this.storage = new Map<Epoch, EpochInfo>();
  }

  public epoch(epoch: Epoch) {
    const epochStorageData = this.storage.get(epoch) ?? { summary: new Map(), meta: {} };
    return {
      setMeta: (val: EpochMeta) => {
        const curr = epochStorageData.meta;
        epochStorageData.meta = merge(curr, val);
        this.storage.set(epoch, epochStorageData);
      },
      getMeta: (): EpochMeta => {
        return epochStorageData.meta;
      },
      set: (val: ValidatorDutySummary) => {
        const curr = epochStorageData.summary.get(val.val_id) ?? {};
        epochStorageData.summary.set(val.val_id, merge(curr, val));
        this.storage.set(epoch, epochStorageData);
      },
      get: (val_id: ValidatorId): ValidatorDutySummary => {
        return epochStorageData.summary.get(val_id);
      },
      values: () => {
        return epochStorageData.summary.values();
      },
      valuesToWrite: () => {
        // we
        return [...epochStorageData.summary.values()].map((v) => ({
          ...v,
          val_balance: v.val_balance.toString(),
          val_effective_balance: v.val_effective_balance.toString(),
          propose_earned_reward: v.propose_earned_reward?.toString(),
          propose_missed_reward: v.propose_missed_reward?.toString(),
          propose_penalty: v.propose_penalty?.toString(),
          att_meta: undefined,
          sync_meta: undefined,
        }));
      },
    };
  }

  public clear() {
    this.storage.clear();
  }
}
