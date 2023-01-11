import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/eth-providers/consensus-provider/types';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { RegistryService, RegistrySourceOperator } from 'common/validators-registry';
import { ClickhouseService } from 'storage';

@Injectable()
export class ProposeMetrics {
  protected processedEpoch: number;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  @TrackTask('calc-propose-metrics')
  public async calculate(epoch: Epoch, possibleHighRewardValidators: string[]) {
    this.logger.log('Calculating propose metrics');
    this.processedEpoch = epoch;
    this.operators = await this.registryService.getOperators();
    await Promise.all([this.goodProposes(), this.missProposes(), this.highRewardMissProposes(possibleHighRewardValidators)]);
  }

  private async goodProposes() {
    const result = await this.storage.getValidatorsCountWithGoodProposes(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_id != null && +p.val_nos_id == operator.index);
      this.prometheus.validatorsCountGoodPropose.set({ nos_name: operator.name }, operatorResult ? operatorResult.amount : 0);
    });
    const other = result.find((p) => p.val_nos_id == null);
    this.prometheus.otherValidatorsCountGoodPropose.set(other ? other.amount : 0);
  }

  private async missProposes() {
    const result = await this.storage.getValidatorsCountWithMissedProposes(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_id != null && +p.val_nos_id == operator.index);
      this.prometheus.validatorsCountMissPropose.set({ nos_name: operator.name }, operatorResult ? operatorResult.amount : 0);
    });
    const other = result.find((p) => p.val_nos_id == null);
    this.prometheus.otherValidatorsCountMissPropose.set(other ? other.amount : 0);
  }

  private async highRewardMissProposes(possibleHighRewardValidators: string[]) {
    let result = [];
    if (possibleHighRewardValidators.length > 0)
      result = await this.storage.getValidatorsCountWithMissedProposes(this.processedEpoch, possibleHighRewardValidators);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_id != null && +p.val_nos_id == operator.index);
      this.prometheus.highRewardValidatorsCountMissPropose.set({ nos_name: operator.name }, operatorResult ? operatorResult.amount : 0);
    });
  }
}
