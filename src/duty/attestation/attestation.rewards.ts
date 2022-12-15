import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ValStatus } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';

import { SummaryService } from '../summary';
import { attestationRewards } from './attestation.constants';

@Injectable()
export class AttestationRewards {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly summary: SummaryService,
  ) {}

  public calculate(epoch: bigint) {
    const epochMeta = this.summary.getMeta();
    const blocksAttestationsRewardSum = new Map<bigint, bigint>();
    // Attestation reward multipliers
    const sourceParticipation = epochMeta.attestation.correct_source / epochMeta.state.active_validators;
    const targetParticipation = epochMeta.attestation.correct_target / epochMeta.state.active_validators;
    const headParticipation = epochMeta.attestation.correct_head / epochMeta.state.active_validators;
    // Perfect attestation (with multipliers). Need for calculating missed reward
    const perfect = attestationRewards(1, true, true, true);
    const perfectAttestationRewards = BigInt(
      Math.trunc(perfect.source * epochMeta.state.base_reward * 32 * sourceParticipation) +
        Math.trunc(perfect.target * epochMeta.state.base_reward * 32 * targetParticipation) +
        Math.trunc(perfect.head * epochMeta.state.base_reward * 32 * headParticipation),
    );
    //
    for (const v of this.summary.values()) {
      // Only active validator can participate in attestation
      if (![ValStatus.ActiveOngoing, ValStatus.ActiveExiting, ValStatus.ActiveSlashed].includes(v.val_status)) continue;

      const increments = Number(BigInt(v.val_effective_balance) / BigInt(10 ** 9));
      let att_earned_reward = 0n;
      let att_missed_reward = 0n;
      let att_penalty = 0n;
      const rewardSource = Math.trunc(v.att_meta.reward_per_increment.source * epochMeta.state.base_reward * increments);
      const rewardTarget = Math.trunc(v.att_meta.reward_per_increment.target * epochMeta.state.base_reward * increments);
      const rewardHead = Math.trunc(v.att_meta.reward_per_increment.head * epochMeta.state.base_reward * increments);
      const penaltySource = Math.trunc(v.att_meta.penalty_per_increment.source * epochMeta.state.base_reward * increments);
      const penaltyTarget = Math.trunc(v.att_meta.penalty_per_increment.target * epochMeta.state.base_reward * increments);
      const penaltyHead = Math.trunc(v.att_meta.penalty_per_increment.head * epochMeta.state.base_reward * increments);
      att_earned_reward = BigInt(
        Math.trunc(rewardSource * sourceParticipation) +
          Math.trunc(rewardTarget * targetParticipation) +
          Math.trunc(rewardHead * headParticipation),
      );
      att_missed_reward = perfectAttestationRewards - att_earned_reward;
      att_penalty = BigInt(penaltySource + penaltyTarget + penaltyHead);

      if (att_earned_reward != 0n) {
        // Calculate sum of all attestation rewards in block (without multipliers). It's needed for calculation proposer reward
        let rewards = blocksAttestationsRewardSum.get(v.att_meta.included_in_block) ?? 0n;
        rewards += BigInt(rewardSource + rewardTarget + rewardHead);
        blocksAttestationsRewardSum.set(v.att_meta.included_in_block, rewards);
      }

      this.summary.set(v.val_id, { epoch, val_id: v.val_id, att_earned_reward, att_missed_reward, att_penalty });
    }
    this.summary.setMeta({ attestation: { blocks_rewards: blocksAttestationsRewardSum } });
    return true;
  }
}
