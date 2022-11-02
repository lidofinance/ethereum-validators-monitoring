import { Injectable } from '@nestjs/common';

import { ValStatus } from 'common/eth-providers';

export interface ValidatorDutySummary {
  epoch: bigint;
  ///
  val_id: bigint;
  val_nos_id?: number;
  val_nos_name?: string;
  val_slashed?: boolean;
  val_status?: ValStatus;
  val_balance?: bigint;
  ///
  is_proposer?: boolean;
  block_to_propose?: bigint;
  block_proposed?: boolean;
  ///
  is_sync?: boolean;
  sync_percent?: number;
  ///
  att_inc_delay?: number;
  att_valid_head?: boolean;
  att_valid_target?: boolean;
  att_valid_source?: boolean;
}

@Injectable()
export class SummaryService {
  protected storage: Map<bigint, ValidatorDutySummary>;

  constructor() {
    this.storage = new Map<bigint, ValidatorDutySummary>();
  }

  public get(index: bigint) {
    return this.storage.get(index);
  }

  public set(index: bigint, summary: ValidatorDutySummary) {
    this.storage.set(index, { ...(this.get(index) ?? {}), ...summary });
  }

  public values(): Iterator<ValidatorDutySummary> {
    return this.storage.values();
  }

  public clear() {
    this.storage.clear();
  }
}
