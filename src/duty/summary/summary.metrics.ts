import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/consensus-provider';
import { Epoch } from 'common/consensus-provider/types';
import { allSettled } from 'common/functions/allSettled';
import { PrometheusService, TrackTask, setUserOperatorsMetric } from 'common/prometheus';
import { ClickhouseService } from 'storage';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';

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
    this.operators = this.registryService.getOperators();
    await allSettled([this.userRewards(), this.avgChainRewards(), this.common()]);
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
    const data = await this.storage.getUserNodeOperatorsRewardsAndPenaltiesStats(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.operatorReward, data, this.operators, { duty: Duty.Attestation }, (item) => item.att_reward);
    setUserOperatorsMetric(this.prometheus.operatorReward, data, this.operators, { duty: Duty.Proposal }, (item) => item.prop_reward);
    setUserOperatorsMetric(this.prometheus.operatorReward, data, this.operators, { duty: Duty.Sync }, (item) => item.sync_reward);
    setUserOperatorsMetric(
      this.prometheus.operatorMissedReward,
      data,
      this.operators,
      { duty: Duty.Attestation },
      (item) => item.att_missed,
    );
    setUserOperatorsMetric(this.prometheus.operatorMissedReward, data, this.operators, { duty: Duty.Proposal }, (item) => item.prop_missed);
    setUserOperatorsMetric(this.prometheus.operatorMissedReward, data, this.operators, { duty: Duty.Sync }, (item) => item.sync_missed);
    setUserOperatorsMetric(this.prometheus.operatorPenalty, data, this.operators, { duty: Duty.Attestation }, (item) => item.att_penalty);
    setUserOperatorsMetric(this.prometheus.operatorPenalty, data, this.operators, { duty: Duty.Proposal }, (item) => item.prop_penalty);
    setUserOperatorsMetric(this.prometheus.operatorPenalty, data, this.operators, { duty: Duty.Sync }, (item) => item.sync_penalty);
    setUserOperatorsMetric(this.prometheus.operatorRealBalanceDelta, data, this.operators, {}, (item) => item.real_balance_change);
    setUserOperatorsMetric(
      this.prometheus.operatorCalculatedBalanceDelta,
      data,
      this.operators,
      {},
      (item) => item.calculated_balance_change,
    );
    setUserOperatorsMetric(
      this.prometheus.operatorCalculatedBalanceCalculationError,
      data,
      this.operators,
      {},
      (item) => item.calculation_error,
    );
  }
}
