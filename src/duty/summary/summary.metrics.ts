import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/eth-providers';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { RegistryService, RegistrySourceOperator } from '../../common/validators-registry';
import { ClickhouseService } from '../../storage';

enum Duty {
  Proposal = 'proposal',
  Sync = 'sync',
  Attestation = 'attestation',
}

@Injectable()
export class SummaryMetrics {
  protected processedEpoch: bigint;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  @TrackTask('calc-state-metrics')
  public async calculate(epoch: bigint) {
    this.logger.log('Calculating propose metrics');
    this.processedEpoch = epoch;
    this.operators = await this.registryService.getOperators();
    await Promise.all([this.rewards(), this.common()]);
  }

  private async common() {
    this.prometheus.epochTime = await this.clClient.getSlotTime(this.processedEpoch * 32n);
    this.prometheus.epochNumber.set(Number(this.processedEpoch));
  }

  private async rewards() {
    const result = await this.storage.getUserNodeOperatorsRewardsAndPenaltiesStats(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_name == operator.name);
      // Rewards
      this.prometheus.operatorReward.set(
        { nos_name: operator.name, duty: Duty.Attestation },
        operatorResult ? operatorResult.attestation_reward : 0,
      );
      this.prometheus.operatorReward.set({ nos_name: operator.name, duty: Duty.Proposal }, operatorResult ? operatorResult.prop_reward : 0);
      this.prometheus.operatorReward.set({ nos_name: operator.name, duty: Duty.Sync }, operatorResult ? operatorResult.sync_reward : 0);
      // Missed rewards
      this.prometheus.operatorMissedReward.set(
        { nos_name: operator.name, duty: Duty.Attestation },
        operatorResult ? operatorResult.attestation_missed : 0,
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
        operatorResult ? operatorResult.attestation_penalty : 0,
      );
      this.prometheus.operatorPenalty.set(
        { nos_name: operator.name, duty: Duty.Proposal },
        operatorResult ? operatorResult.prop_penalty : 0,
      );
      this.prometheus.operatorPenalty.set({ nos_name: operator.name, duty: Duty.Sync }, operatorResult ? operatorResult.sync_penalty : 0);
    });
  }
}
