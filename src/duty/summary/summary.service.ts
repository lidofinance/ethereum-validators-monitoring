import { Injectable } from '@nestjs/common';
import { merge } from 'lodash';

import { ValStatus } from 'common/eth-providers';

type BlockNumber = bigint;
type ValidatorId = bigint;

interface ValidatorAttestationReward {
  source: number;
  target: number;
  head: number;
}

interface ValidatorAttestationPenalty extends ValidatorAttestationReward {}

export interface ValidatorDutySummary {
  epoch: bigint;
  ///
  val_id: bigint;
  val_nos_id?: number;
  val_nos_name?: string;
  val_slashed?: boolean;
  val_status?: ValStatus;
  val_balance?: bigint;
  val_effective_balance?: bigint;
  ///
  is_proposer?: boolean;
  block_to_propose?: bigint;
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
    synced_blocks?: bigint[];
  };
  att_meta?: {
    included_in_block?: bigint;
    reward_per_increment?: ValidatorAttestationReward;
    penalty_per_increment?: ValidatorAttestationPenalty;
  };
  // Rewards
  att_earned_reward?: bigint;
  att_missed_reward?: bigint;
  att_penalty?: bigint;
  sync_earned_reward?: bigint;
  sync_missed_reward?: bigint;
  sync_penalty?: bigint;
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
    blocks_rewards?: Map<BlockNumber, bigint>;
    correct_source?: number;
    correct_target?: number;
    correct_head?: number;
  };
  sync?: {
    blocks_rewards?: Map<BlockNumber, bigint>;
    blocks_to_sync?: bigint[];
  };
}

@Injectable()
export class SummaryService {
  protected storage: Map<ValidatorId, ValidatorDutySummary>;
  protected meta: EpochMeta;

  constructor() {
    this.storage = new Map<ValidatorId, ValidatorDutySummary>();
    this.meta = {};
  }

  public setMeta(val: EpochMeta) {
    const curr = this.meta ?? {};
    this.meta = merge(curr, val);
  }

  public getMeta() {
    return this.meta;
  }

  public get(index: bigint) {
    return this.storage.get(index);
  }

  public set(index: bigint, summary: ValidatorDutySummary) {
    const curr = this.get(index) ?? {};
    this.storage.set(index, merge(curr, summary));
  }

  public values(): IterableIterator<ValidatorDutySummary> {
    return this.storage.values();
  }

  public clear() {
    this.storage.clear();
  }

  public clearMeta() {
    delete this.meta;
  }
}
