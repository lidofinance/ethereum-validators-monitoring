import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';

import { SummaryService } from '../summary';
import { syncReward } from './sync.constants';

@Injectable()
export class SyncRewards {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly summary: SummaryService,
  ) {}

  public calculate(epoch: bigint) {
    const epochMeta = this.summary.getMeta(epoch);
    let sync_earned_reward = 0n;
    let sync_missed_reward = 0n;
    let sync_penalty = 0n;
    const perBlockSyncReward = syncReward(epochMeta.state.active_validators_total_increments, epochMeta.state.base_reward);
    const perfectSync = perBlockSyncReward * BigInt(epochMeta.sync.blocks_to_sync.length);
    const blocksSyncRewardSum = new Map<bigint, bigint>();
    // block can be with zero synchronization
    epochMeta.sync.blocks_to_sync.forEach((b) => blocksSyncRewardSum.set(b, 0n));
    for (const v of this.summary.values()) {
      if (!v.is_sync) continue;
      for (const block of v.sync_meta.synced_blocks) {
        blocksSyncRewardSum.set(block, blocksSyncRewardSum.get(block) + perBlockSyncReward);
      }

      sync_earned_reward = perBlockSyncReward * BigInt(v.sync_meta.synced_blocks.length);
      sync_penalty = perBlockSyncReward * BigInt(epochMeta.sync.blocks_to_sync.length - v.sync_meta.synced_blocks.length);
      sync_missed_reward = perfectSync - sync_earned_reward;

      this.summary.set(v.val_id, { epoch, val_id: v.val_id, sync_earned_reward, sync_penalty, sync_missed_reward });
    }
    this.summary.setMeta(epoch, { sync: { blocks_rewards: blocksSyncRewardSum } });
    return true;
  }
}
