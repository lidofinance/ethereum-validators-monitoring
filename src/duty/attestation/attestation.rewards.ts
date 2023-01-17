import { FixedNumber } from '@ethersproject/bignumber';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/eth-providers/consensus-provider/types';
import { PrometheusService } from 'common/prometheus';

import { SummaryService } from '../summary';
import { getPenalties, getRewards } from './attestation.constants';

@Injectable()
export class AttestationRewards {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly summary: SummaryService,
  ) {}

  public async calculate(epoch: Epoch) {
    const epochMeta = this.summary.epoch(epoch).getMeta();
    // Attestation reward multipliers
    const sourceParticipation = Number.parseFloat(
      FixedNumber.from(epochMeta.attestation.participation.source)
        .divUnsafe(FixedNumber.from(epochMeta.state.active_validators_total_increments))
        .toString(),
    );
    const targetParticipation = Number.parseFloat(
      FixedNumber.from(epochMeta.attestation.participation.target)
        .divUnsafe(FixedNumber.from(epochMeta.state.active_validators_total_increments))
        .toString(),
    );
    const headParticipation = Number.parseFloat(
      FixedNumber.from(epochMeta.attestation.participation.head)
        .divUnsafe(FixedNumber.from(epochMeta.state.active_validators_total_increments))
        .toString(),
    );
    // Perfect attestation (with multipliers). Need for calculating missed reward
    const perfect = getRewards({ source: true, target: true, head: true });
    const perfectAttestationRewards =
      Math.trunc(perfect.source * epochMeta.state.base_reward * 32 * sourceParticipation) +
      Math.trunc(perfect.target * epochMeta.state.base_reward * 32 * targetParticipation) +
      Math.trunc(perfect.head * epochMeta.state.base_reward * 32 * headParticipation);
    for (const v of this.summary.epoch(epoch).values()) {
      // Calculate attestation rewards from previous epoch
      const pv = this.summary.epoch(epoch - 1).get(v.val_id);
      if (pv?.att_happened == undefined) continue; // we shouldn't calculate rewards for validators who didn't attest
      const increments = Number(v.val_effective_balance / BigInt(10 ** 9));
      let att_earned_reward = 0;
      let att_missed_reward = 0;
      let att_penalty = 0;
      const rewards = getRewards({ source: pv.att_valid_source, target: pv.att_valid_target, head: pv.att_valid_head });
      const penalties = getPenalties({ source: pv.att_valid_source, target: pv.att_valid_target, head: pv.att_valid_head });
      const rewardSource = Math.trunc(rewards.source * epochMeta.state.base_reward * increments * sourceParticipation);
      const rewardTarget = Math.trunc(rewards.target * epochMeta.state.base_reward * increments * targetParticipation);
      const rewardHead = Math.trunc(rewards.head * epochMeta.state.base_reward * increments * headParticipation);
      const penaltySource = Math.trunc(penalties.source * epochMeta.state.base_reward * increments);
      const penaltyTarget = Math.trunc(penalties.target * epochMeta.state.base_reward * increments);
      const penaltyHead = Math.trunc(penalties.head * epochMeta.state.base_reward * increments);
      att_earned_reward = rewardSource + rewardTarget + rewardHead;
      att_missed_reward = perfectAttestationRewards - att_earned_reward;
      att_penalty = penaltySource + penaltyTarget + penaltyHead;
      // And save it to summary of current epoch
      this.summary.epoch(epoch).set({
        epoch,
        val_id: v.val_id,
        att_inc_delay: pv.att_inc_delay,
        att_valid_source: pv.att_valid_source,
        att_valid_target: pv.att_valid_target,
        att_valid_head: pv.att_valid_head,
        att_earned_reward,
        att_missed_reward,
        att_penalty,
      });
    }
    return true;
  }
}
