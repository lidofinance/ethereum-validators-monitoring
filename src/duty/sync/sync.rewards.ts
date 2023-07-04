import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { PrometheusService } from 'common/prometheus';
import { SummaryService } from 'duty/summary';

@Injectable()
export class SyncRewards {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly summary: SummaryService,
  ) {}

  public async calculate(epoch: Epoch) {
    const epochMeta = this.summary.epoch(epoch).getMeta();
    let sync_earned_reward = 0;
    let sync_missed_reward = 0;
    let sync_penalty = 0;
    const perfectSync = epochMeta.sync.per_block_reward * epochMeta.sync.blocks_to_sync.length;
    for (const v of this.summary.epoch(epoch).values()) {
      if (!v.is_sync) continue;
      sync_earned_reward = epochMeta.sync.per_block_reward * v.sync_meta.synced_blocks.length;
      sync_penalty = epochMeta.sync.per_block_reward * (epochMeta.sync.blocks_to_sync.length - v.sync_meta.synced_blocks.length);
      sync_missed_reward = perfectSync - sync_earned_reward;

      this.summary.epoch(epoch).set({ epoch, val_id: v.val_id, sync_earned_reward, sync_penalty, sync_missed_reward });
    }
  }
}
