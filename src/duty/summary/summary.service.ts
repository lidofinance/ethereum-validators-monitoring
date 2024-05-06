import { Injectable } from '@nestjs/common';
import { merge } from 'lodash';

import { ValStatus } from 'common/consensus-provider';
import { Epoch } from 'common/consensus-provider/types';
import { range } from 'common/functions/range';

type BlockNumber = number;
type ValidatorId = number;

export interface ValidatorDutySummary {
  epoch: Epoch;
  ///
  val_id: number;
  val_pubkey?: string;
  val_nos_module_id?: number;
  val_nos_id?: number;
  val_nos_name?: string;
  val_slashed?: boolean;
  val_status?: ValStatus;
  val_balance?: bigint;
  val_balance_withdrawn?: bigint;
  val_stuck?: boolean;
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
    blocks_attestations?: Map<BlockNumber, { source?: number[]; target?: number[]; head?: number[] }[]>;
    blocks_rewards?: Map<BlockNumber, bigint>;
  };
  sync?: {
    per_block_reward?: number;
    blocks_to_sync?: number[];
    blocks_rewards?: Map<BlockNumber, bigint>;
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
    if (!this.storage.get(epoch)) this.init(epoch); // Initialize epoch
    const epochStorageData = this.storage.get(epoch);
    return {
      setMeta: (val: EpochMeta) => {
        const curr = epochStorageData.meta;
        epochStorageData.meta = merge(curr, val);
      },
      getMeta: (): EpochMeta => {
        return epochStorageData.meta;
      },
      set: (val: ValidatorDutySummary) => {
        const curr = epochStorageData.summary.get(val.val_id) ?? {};
        epochStorageData.summary.set(val.val_id, merge(curr, val));
      },
      get: (val_id: ValidatorId): ValidatorDutySummary => {
        return epochStorageData.summary.get(val_id);
      },
      values: () => {
        return epochStorageData.summary.values();
      },
    };
  }

  public clear() {
    this.storage.clear();
  }

  private init(epoch: Epoch) {
    this.storage.set(epoch, {
      summary: new Map(),
      meta: {
        state: {
          active_validators: 0,
          active_validators_total_increments: 0n,
          base_reward: 0,
        },
        attestation: {
          participation: { source: 0n, target: 0n, head: 0n },
          blocks_attestations: new Map<BlockNumber, { source?: number[]; target?: number[]; head?: number[] }[]>(
            range(epoch * 32 - 32, epoch * 32 + 32).map((b) => [b, []]),
          ),
          blocks_rewards: new Map<BlockNumber, bigint>(range(epoch * 32 - 32, epoch * 32 + 32).map((b) => [b, 0n])),
        },
        sync: {
          blocks_rewards: new Map<BlockNumber, bigint>(range(epoch * 32 - 32, epoch * 32 + 32).map((b) => [b, 0n])),
          per_block_reward: 0,
          blocks_to_sync: [],
        },
      },
    });
  }
}
