import { BigNumber } from '@ethersproject/bignumber';
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
  val_nos_id?: number;
  val_nos_name?: string;
  val_slashed?: boolean;
  val_status?: ValStatus;
  val_balance?: BigNumber;
  val_effective_balance?: BigNumber;
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
  att_meta?: {
    included_in_block?: number;
    reward_per_increment?: ValidatorAttestationReward;
    penalty_per_increment?: ValidatorAttestationPenalty;
  };
  // Rewards
  att_earned_reward?: number;
  att_missed_reward?: number;
  att_penalty?: number;
  sync_earned_reward?: number;
  sync_missed_reward?: number;
  sync_penalty?: number;
  propose_earned_reward?: BigNumber;
  propose_missed_reward?: BigNumber;
  propose_penalty?: BigNumber;
}

export interface EpochMeta {
  // will be stored in DB in separate table
  state?: {
    active_validators?: number;
    active_validators_total_increments?: BigNumber;
    base_reward?: number;
  };
  attestation?: {
    participation?: { source: BigNumber; target: BigNumber; head: BigNumber };
    blocks_rewards?: Map<BlockNumber, BigNumber>;
  };
  sync?: {
    blocks_rewards?: Map<BlockNumber, BigNumber>;
    per_block_reward?: number;
    blocks_to_sync?: number[];
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

  public get(index: number) {
    return this.storage.get(index);
  }

  public set(index: number, summary: ValidatorDutySummary) {
    const curr = this.get(index) ?? {};
    this.storage.set(index, merge(curr, summary));
  }

  public values(): IterableIterator<ValidatorDutySummary> {
    return this.storage.values();
  }

  public valuesToWrite(): any[] {
    return [...this.storage.values()].map((v) => ({
      ...v,
      val_balance: v.val_balance.toString(),
      val_effective_balance: v.val_effective_balance.toString(),
      propose_earned_reward: v.propose_earned_reward?.toString(),
      propose_missed_reward: v.propose_missed_reward?.toString(),
      propose_penalty: v.propose_penalty?.toString(),
      att_meta: undefined,
      sync_meta: undefined,
    }));
  }

  public clear() {
    this.storage.clear();
  }

  public clearMeta() {
    delete this.meta;
  }
}
