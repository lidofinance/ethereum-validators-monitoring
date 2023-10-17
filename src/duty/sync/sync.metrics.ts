import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { allSettled } from 'common/functions/allSettled';
import { PrometheusService, TrackTask, setOtherOperatorsMetric, setUserOperatorsMetric } from 'common/prometheus';
import { ClickhouseService } from 'storage';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';

import { Epoch } from '../../common/consensus-provider/types';

@Injectable()
export class SyncMetrics {
  protected readonly epochInterval;
  protected processedEpoch: number;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {
    this.epochInterval = this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG');
  }

  @TrackTask('calc-sync-metrics')
  public async calculate(epoch: Epoch, possibleHighRewardValidators: string[]) {
    this.logger.log('Calculating sync committee metrics');
    this.processedEpoch = epoch;
    this.operators = this.registryService.getOperators();

    await allSettled([
      this.userAvgSyncPercent(),
      this.otherAvgSyncPercent(),
      this.operatorAvgSyncPercents(),
      this.syncParticipation(possibleHighRewardValidators),
    ]);
  }

  private async userAvgSyncPercent() {
    const result = await this.storage.getUserSyncParticipationAvgPercent(this.processedEpoch);
    if (result)
      result.forEach((r) => this.prometheus.userSyncParticipationAvgPercent.set({ nos_module_id: r.val_nos_module_id }, r.amount));
    else this.prometheus.userSyncParticipationAvgPercent.remove();
  }

  private async otherAvgSyncPercent() {
    const result = await this.storage.getOtherSyncParticipationAvgPercent(this.processedEpoch);
    if (result) this.prometheus.otherSyncParticipationAvgPercent.set(result.amount);
    else this.prometheus.otherSyncParticipationAvgPercent.remove();
  }

  private async operatorAvgSyncPercents() {
    const data = await this.storage.getOperatorSyncParticipationAvgPercents(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.operatorSyncParticipationAvgPercent, data, this.operators);
  }

  private async syncParticipation(possibleHighRewardValidators: string[]) {
    const chainAvgSyncPercent = await this.chainAvgSyncPercent();
    await allSettled([
      this.goodSyncParticipationLastEpoch(chainAvgSyncPercent),
      this.badSyncParticipationLastEpoch(chainAvgSyncPercent),
      this.badSyncParticipationLastNEpoch(chainAvgSyncPercent),
      this.highRewardSyncParticipationLastNEpoch(chainAvgSyncPercent, possibleHighRewardValidators),
    ]);
  }

  private async chainAvgSyncPercent() {
    const result = await this.storage.getChainSyncParticipationAvgPercent(this.processedEpoch);
    this.prometheus.chainSyncParticipationAvgPercent.set(result.amount);
    return result.amount;
  }

  private async goodSyncParticipationLastEpoch(chainAvgSyncPercent: number) {
    const data = await this.storage.getValidatorsCountWithGoodSyncParticipationLastNEpoch(this.processedEpoch, 1, chainAvgSyncPercent);
    setUserOperatorsMetric(this.prometheus.validatorsCountWithGoodSyncParticipation, data, this.operators);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountWithGoodSyncParticipation, data);
  }

  private async badSyncParticipationLastEpoch(chainAvgSyncPercent: number) {
    const data = await this.storage.getValidatorsCountWithBadSyncParticipationLastNEpoch(this.processedEpoch, 1, chainAvgSyncPercent);
    setUserOperatorsMetric(this.prometheus.validatorsCountWithSyncParticipationLessAvg, data, this.operators);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountWithSyncParticipationLessAvg, data);
  }

  private async badSyncParticipationLastNEpoch(chainAvgSyncPercent: number) {
    const data = await this.storage.getValidatorsCountWithBadSyncParticipationLastNEpoch(
      this.processedEpoch,
      this.epochInterval,
      chainAvgSyncPercent,
    );
    setUserOperatorsMetric(this.prometheus.validatorsCountWithSyncParticipationLessAvgLastNEpoch, data, this.operators, {
      epoch_interval: this.epochInterval,
    });
  }

  private async highRewardSyncParticipationLastNEpoch(chainAvgSyncPercent: number, possibleHighRewardValidators: string[]) {
    if (possibleHighRewardValidators.length > 0) {
      const data = await this.storage.getValidatorsCountWithBadSyncParticipationLastNEpoch(
        this.processedEpoch,
        this.epochInterval,
        chainAvgSyncPercent,
        possibleHighRewardValidators,
      );
      setUserOperatorsMetric(this.prometheus.highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch, data, this.operators, {
        epoch_interval: this.epochInterval,
      });
    }
  }
}
