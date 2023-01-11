import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/eth-providers/consensus-provider/types';
import { PrometheusService } from 'common/prometheus';

import { EpochMeta, SummaryService } from '../summary';
import { proposerAttPartReward } from './propose.constants';

@Injectable()
export class ProposeRewards {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly summary: SummaryService,
  ) {}

  public async calculate(epoch: Epoch, prevEpochMetadata: EpochMeta) {
    let attestationsSumOfSum = 0n;
    let syncSumOfSum = 0n;
    // Merge attestations metadata from two epochs
    // It's needed to calculate rewards of checkpoint block. Because first block of epoch contains attestations from previous
    // At the first app start it is possible that reward for such block will not be calculated,
    // because there is no metadata of the previous epoch
    const blocksAttestationsRewardSum = new Map<number, bigint>();
    const prevEpoch = prevEpochMetadata.attestation?.blocks_rewards ?? new Map();
    if (prevEpoch.size == 0) {
      this.logger.warn(
        "Proposal reward will not be calculated accurately because previous epoch's metadata does not exist. " +
          "Probably, it's the first run of application",
      );
    }
    const currEpoch = this.summary.getMeta().attestation.blocks_rewards;
    for (const block of new Map([...prevEpoch.entries(), ...currEpoch.entries()]).keys()) {
      let merged = 0n;
      const prev = prevEpoch.get(block) ?? 0n;
      const curr = currEpoch.get(block) ?? 0n;
      merged += prev + curr;
      blocksAttestationsRewardSum.set(block, merged);
    }
    const blocksSyncRewardSum = this.summary.getMeta().sync.blocks_rewards;

    blocksAttestationsRewardSum.forEach((rewards) => (attestationsSumOfSum += rewards));
    const attestationsAvg = attestationsSumOfSum / BigInt(blocksAttestationsRewardSum.size);

    blocksSyncRewardSum.forEach((rewards) => (syncSumOfSum += rewards));
    const syncAvg = syncSumOfSum / BigInt(blocksSyncRewardSum.size);

    for (const v of this.summary.values()) {
      if (!v.is_proposer) continue;
      let propose_earned_reward = 0n;
      let propose_missed_reward = 0n;
      const propose_penalty = 0n;
      if (v.block_proposed) {
        const attRewardSum = blocksAttestationsRewardSum.get(v.block_to_propose);
        const syncRewardSum = blocksSyncRewardSum.get(v.block_to_propose);
        if (attRewardSum == undefined || syncRewardSum == undefined) {
          this.logger.warn(`Can't calculate reward for block ${v.block_to_propose}. There is no metadata of previous epoch`);
          continue;
        }
        propose_earned_reward = proposerAttPartReward(attRewardSum) + syncRewardSum;
      } else {
        propose_missed_reward = proposerAttPartReward(attestationsAvg) + syncAvg;
      }
      this.summary.set(v.val_id, {
        epoch,
        val_id: v.val_id,
        propose_earned_reward,
        propose_missed_reward,
        propose_penalty,
      });
    }
  }
}
