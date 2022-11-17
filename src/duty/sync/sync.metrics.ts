import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { RegistryService, RegistrySourceOperator } from 'common/validators-registry';
import { ClickhouseService } from 'storage';

@Injectable()
export class SyncMetrics {
  protected readonly epochInterval;
  protected processedEpoch: bigint;
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
  public async calculate(epoch: bigint, possibleHighRewardValidators: string[]) {
    this.logger.log('Calculating sync committee metrics');
    this.processedEpoch = epoch;
    this.operators = await this.registryService.getOperators();

    await Promise.all([
      this.userAvgSyncPercent(),
      this.otherAvgSyncPercent(),
      this.operatorAvgSyncPercents(),
      this.syncParticipation(possibleHighRewardValidators),
    ]);
  }

  private async userAvgSyncPercent() {
    const result = await this.storage.getUserSyncParticipationAvgPercent(this.processedEpoch);
    this.prometheus.userSyncParticipationAvgPercent.set(result.avg_percent ?? 0);
  }

  private async otherAvgSyncPercent() {
    const result = await this.storage.getOtherSyncParticipationAvgPercent(this.processedEpoch);
    this.prometheus.otherSyncParticipationAvgPercent.set(result.avg_percent);
  }

  private async operatorAvgSyncPercents() {
    const result = await this.storage.getOperatorSyncParticipationAvgPercents(this.processedEpoch);
    result.forEach((p) => {
      this.prometheus.operatorSyncParticipationAvgPercent.set({ nos_name: p.val_nos_name }, p.avg_percent);
    });
  }

  private async syncParticipation(possibleHighRewardValidators: string[]) {
    const chainAvgSyncPercent = await this.chainAvgSyncPercent();
    await Promise.all([
      this.goodSyncParticipationLastEpoch(chainAvgSyncPercent),
      this.badSyncParticipationLastEpoch(chainAvgSyncPercent),
      this.badSyncParticipationLastNEpoch(chainAvgSyncPercent),
      this.highRewardSyncParticipationLastNEpoch(chainAvgSyncPercent, possibleHighRewardValidators),
    ]);
  }

  private async chainAvgSyncPercent() {
    const result = await this.storage.getChainSyncParticipationAvgPercent(this.processedEpoch);
    this.prometheus.chainSyncParticipationAvgPercent.set(result.avg_percent);
    return result.avg_percent;
  }

  private async goodSyncParticipationLastEpoch(chainAvgSyncPercent: number) {
    const result = await this.storage.getValidatorsCountWithGoodSyncParticipationLastNEpoch(this.processedEpoch, 1, chainAvgSyncPercent);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithGoodSyncParticipation.set({ nos_name: operator.name }, operatorResult ? operatorResult.amount : 0);
    });
    const other = result.find((p) => p.val_nos_name == 'NULL');
    this.prometheus.otherValidatorsCountWithGoodSyncParticipation.set(other ? other.amount : 0);
  }

  private async badSyncParticipationLastEpoch(chainAvgSyncPercent: number) {
    const result = await this.storage.getValidatorsCountWithBadSyncParticipationLastNEpoch(this.processedEpoch, 1, chainAvgSyncPercent);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvg.set(
        { nos_name: operator.name },
        operatorResult ? operatorResult.amount : 0,
      );
    });
    const other = result.find((p) => p.val_nos_name == 'NULL');
    this.prometheus.otherValidatorsCountWithSyncParticipationLessAvg.set(other ? other.amount : 0);
  }

  private async badSyncParticipationLastNEpoch(chainAvgSyncPercent: number) {
    const result = await this.storage.getValidatorsCountWithBadSyncParticipationLastNEpoch(
      this.processedEpoch,
      this.epochInterval,
      chainAvgSyncPercent,
    );
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async highRewardSyncParticipationLastNEpoch(chainAvgSyncPercent: number, possibleHighRewardValidators: string[]) {
    let result = [];
    if (possibleHighRewardValidators.length > 0)
      result = await this.storage.getValidatorsCountWithBadSyncParticipationLastNEpoch(
        this.processedEpoch,
        this.epochInterval,
        chainAvgSyncPercent,
        possibleHighRewardValidators,
      );
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }
}
