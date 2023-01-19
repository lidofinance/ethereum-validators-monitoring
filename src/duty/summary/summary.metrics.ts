import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/eth-providers';
import { Epoch } from 'common/eth-providers/consensus-provider/types';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { RegistryService, RegistrySourceOperator } from 'common/validators-registry';
import { ClickhouseService } from 'storage';

enum Duty {
  Proposal = 'proposal',
  Sync = 'sync',
  Attestation = 'attestation',
}

@Injectable()
export class SummaryMetrics {
  protected processedEpoch: number;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  @TrackTask('calc-summary-metrics')
  public async calculate(epoch: Epoch) {
    this.logger.log('Calculating propose metrics');
    this.processedEpoch = epoch;
    this.operators = await this.registryService.getOperators();
    await Promise.all([this.userRewards(), this.avgChainRewards(), this.common()]);
  }

  private async common() {
    this.prometheus.epochTime = await this.clClient.getSlotTime(this.processedEpoch * 32 + 31);
    this.prometheus.epochNumber.set(Number(this.processedEpoch));
  }

  private async avgChainRewards() {
    const result = await this.storage.getAvgChainRewardsAndPenaltiesStats(this.processedEpoch);
    // Rewards
    this.prometheus.avgChainReward.set({ duty: Duty.Attestation }, result ? result.att_reward : 0);
    this.prometheus.avgChainReward.set({ duty: Duty.Proposal }, result ? result.prop_reward : 0);
    this.prometheus.avgChainReward.set({ duty: Duty.Sync }, result ? result.sync_reward : 0);
    // Missed rewards
    this.prometheus.avgChainMissedReward.set({ duty: Duty.Attestation }, result ? result.att_missed : 0);
    this.prometheus.avgChainMissedReward.set({ duty: Duty.Proposal }, result ? result.prop_missed : 0);
    this.prometheus.avgChainMissedReward.set({ duty: Duty.Sync }, result ? result.sync_missed : 0);
    // Penalty
    this.prometheus.avgChainPenalty.set({ duty: Duty.Attestation }, result ? result.att_penalty : 0);
    this.prometheus.avgChainPenalty.set({ duty: Duty.Proposal }, result ? result.prop_penalty : 0);
    this.prometheus.avgChainPenalty.set({ duty: Duty.Sync }, result ? result.sync_penalty : 0);
  }

  private async userRewards() {
    const result = await this.storage.getUserNodeOperatorsRewardsAndPenaltiesStats(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_id != null && +p.val_nos_id == operator.index);
      // Rewards
      this.prometheus.operatorReward.set(
        { nos_name: operator.name, duty: Duty.Attestation },
        operatorResult ? operatorResult.att_reward : 0,
      );
      this.prometheus.operatorReward.set({ nos_name: operator.name, duty: Duty.Proposal }, operatorResult ? operatorResult.prop_reward : 0);
      this.prometheus.operatorReward.set({ nos_name: operator.name, duty: Duty.Sync }, operatorResult ? operatorResult.sync_reward : 0);
      // Missed rewards
      this.prometheus.operatorMissedReward.set(
        { nos_name: operator.name, duty: Duty.Attestation },
        operatorResult ? operatorResult.att_missed : 0,
      );
      this.prometheus.operatorMissedReward.set(
        { nos_name: operator.name, duty: Duty.Proposal },
        operatorResult ? operatorResult.prop_missed : 0,
      );
      this.prometheus.operatorMissedReward.set(
        { nos_name: operator.name, duty: Duty.Sync },
        operatorResult ? operatorResult.sync_missed : 0,
      );
      // Penalty
      this.prometheus.operatorPenalty.set(
        { nos_name: operator.name, duty: Duty.Attestation },
        operatorResult ? operatorResult.att_penalty : 0,
      );
      this.prometheus.operatorPenalty.set(
        { nos_name: operator.name, duty: Duty.Proposal },
        operatorResult ? operatorResult.prop_penalty : 0,
      );
      this.prometheus.operatorPenalty.set({ nos_name: operator.name, duty: Duty.Sync }, operatorResult ? operatorResult.sync_penalty : 0);
      // Balance deltas (calculated and real)
      this.prometheus.operatorRealBalanceDelta.set({ nos_name: operator.name }, operatorResult ? operatorResult.real_balance_change : 0);
      this.prometheus.operatorCalculatedBalanceDelta.set(
        { nos_name: operator.name },
        operatorResult ? operatorResult.calculated_balance_change : 0,
      );
      // Calculation error
      this.prometheus.operatorCalculatedBalanceCalculationError.set(
        { nos_name: operator.name },
        operatorResult ? operatorResult.calculation_error : 0,
      );
    });
  }
}
