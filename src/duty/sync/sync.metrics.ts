import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { ClickhouseService } from 'storage';

@Injectable()
export class SyncMetrics {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  public async calculate(epoch: bigint, possibleHighRewardValidators: string[]) {
    const operators = await this.registryService.getOperators();
    const userSyncParticipationAvgPercent = await this.storage.getUserSyncParticipationAvgPercent(epoch);
    this.prometheus.userSyncParticipationAvgPercent.set(userSyncParticipationAvgPercent.avg_percent ?? 0);

    const operatorSyncParticipationAvgPercents = await this.storage.getOperatorSyncParticipationAvgPercents(epoch);
    operatorSyncParticipationAvgPercents.forEach((p) => {
      this.prometheus.operatorSyncParticipationAvgPercent.set({ nos_name: p.val_nos_name }, p.avg_percent);
    });

    const chainAvgSyncPercent = await this.storage.getChainSyncParticipationAvgPercent(epoch);
    this.prometheus.chainSyncParticipationAvgPercent.set(chainAvgSyncPercent.avg_percent);

    const otherAvgSyncPercent = await this.storage.getOtherSyncParticipationAvgPercent(epoch);
    this.prometheus.otherSyncParticipationAvgPercent.set(otherAvgSyncPercent.avg_percent);

    const syncParticipationLastEpoch = await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
      epoch,
      1,
      chainAvgSyncPercent.avg_percent,
    );
    const syncParticipationLastNEpoch = await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
      epoch,
      this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
      chainAvgSyncPercent.avg_percent,
    );
    const highRewardSyncParticipationLastNEpoch =
      possibleHighRewardValidators.length > 0
        ? await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
            epoch,
            this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
            chainAvgSyncPercent.avg_percent,
            possibleHighRewardValidators,
          )
        : [];
    operators.forEach((operator) => {
      const last = syncParticipationLastEpoch.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvg.set({ nos_name: operator.name }, last ? last.less_chain_avg_count : 0);
      const lastN = syncParticipationLastNEpoch.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        {
          nos_name: operator.name,
          epoch_interval: this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
        },
        lastN ? lastN.less_chain_avg_count : 0,
      );
      const highRewardLastN = highRewardSyncParticipationLastNEpoch.find((p) => p.val_nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        {
          nos_name: operator.name,
          epoch_interval: this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
        },
        highRewardLastN ? highRewardLastN.less_chain_avg_count : 0,
      );
    });
  }
}
