import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';

import { SummaryService } from '../summary';
import { attestationRewards } from './attestation.constants';

@Injectable()
export class AttestationRewards {
  prevEpoch: any;
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly summary: SummaryService,
  ) {}

  public async calculate(epoch: bigint) {
    const epochMeta = this.summary.getMeta();
    // Attestation reward multipliers
    const sourceParticipation =
      Number(epochMeta.attestation.participation.source) / Number(epochMeta.state.active_validators_total_increments);
    const targetParticipation =
      Number(epochMeta.attestation.participation.target) / Number(epochMeta.state.active_validators_total_increments);
    const headParticipation = Number(epochMeta.attestation.participation.head) / Number(epochMeta.state.active_validators_total_increments);
    // Perfect attestation (with multipliers). Need for calculating missed reward
    const perfect = attestationRewards(1, true, true, true);
    const perfectAttestationRewards = BigInt(
      Math.trunc(perfect.source * epochMeta.state.base_reward * 32 * sourceParticipation) +
        Math.trunc(perfect.target * epochMeta.state.base_reward * 32 * targetParticipation) +
        Math.trunc(perfect.head * epochMeta.state.base_reward * 32 * headParticipation),
    );
    for (const v of this.summary.values()) {
      if (!v.att_meta) continue;
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
      this.summary.set(v.val_id, { epoch, val_id: v.val_id, att_earned_reward, att_missed_reward, att_penalty });
    }
    return true;
  }
}
