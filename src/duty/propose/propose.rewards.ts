import { BigNumber } from '@ethersproject/bignumber';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { PrometheusService } from 'common/prometheus';
import { SummaryService } from 'duty/summary';

@Injectable()
export class ProposeRewards {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly summary: SummaryService,
  ) {}

  public async calculate(epoch: Epoch) {
    let attRewardsSum = BigNumber.from(0);
    let syncRewardsSum = BigNumber.from(0);
    const blocksAttRewards = this.summary.epoch(epoch).getMeta().attestation.blocks_rewards;
    const blocksSyncRewards = this.summary.epoch(epoch).getMeta().sync.blocks_rewards;

    blocksAttRewards.forEach((rewards) => (attRewardsSum = attRewardsSum.add(rewards)));
    const attestationsAvg = attRewardsSum.div(blocksAttRewards.size).toBigInt();

    blocksSyncRewards.forEach((rewards) => (syncRewardsSum = syncRewardsSum.add(rewards)));
    const syncAvg = syncRewardsSum.div(blocksSyncRewards.size).toBigInt();

    for (const v of this.summary.epoch(epoch).values()) {
      if (!v.is_proposer) continue;
      let propose_earned_reward = 0n;
      let propose_missed_reward = 0n;
      const propose_penalty = 0n;
      if (v.block_proposed) {
        const attRewardSum = blocksAttRewards.get(v.block_to_propose);
        const syncRewardSum = blocksSyncRewards.get(v.block_to_propose);
        propose_earned_reward = attRewardSum + syncRewardSum;
      } else {
        propose_missed_reward = attestationsAvg + syncAvg;
      }
      this.summary.epoch(epoch).set({
        epoch,
        val_id: v.val_id,
        propose_earned_reward,
        propose_missed_reward,
        propose_penalty,
      });
    }
  }
}
