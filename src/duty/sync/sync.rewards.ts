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
    for (const v of this.summary.epoch(epoch).values()) {
      if (!v.is_sync) {
        continue;
      }

      const totalBlocksToSync = epochMeta.sync.blocks_to_sync.length * v.sync_meta.length;
      const perfectSync = epochMeta.sync.per_block_reward * totalBlocksToSync;

      let totalSyncedBlocksCount = 0;
      for (const syncMetaItem of v.sync_meta) {
        totalSyncedBlocksCount += syncMetaItem.synced_blocks.length;
      }

      const syncEarnedReward = epochMeta.sync.per_block_reward * totalSyncedBlocksCount;
      this.summary.epoch(epoch).set({
        epoch,
        val_id: v.val_id,
        sync_earned_reward: syncEarnedReward,
        sync_penalty: epochMeta.sync.per_block_reward * (totalBlocksToSync - totalSyncedBlocksCount),
        sync_missed_reward: perfectSync - syncEarnedReward,
      });
    }
  }
}
