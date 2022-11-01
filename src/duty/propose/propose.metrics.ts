import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { RegistryService, RegistrySourceOperator } from 'common/validators-registry';
import { ClickhouseService } from 'storage';

@Injectable()
export class ProposeMetrics {
  protected processedEpoch: bigint;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  @TrackTask('calc-propose-metrics')
  public async calculate(epoch: bigint, possibleHighRewardValidators: string[]) {
    this.logger.log('Calculating propose metrics');
    this.processedEpoch = epoch;
    this.operators = await this.registryService.getOperators();
    await Promise.all([this.missProposes(), this.highRewardMissProposes(possibleHighRewardValidators)]);
  }

  private async missProposes() {
    const result = await this.storage.getValidatorsCountWithMissedProposes(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountMissPropose.set({ nos_name: operator.name }, operatorResult ? operatorResult.miss_propose_count : 0);
    });
  }

  private async highRewardMissProposes(possibleHighRewardValidators: string[]) {
    let result = [];
    if (possibleHighRewardValidators.length > 0)
      result = await this.storage.getValidatorsCountWithMissedProposes(this.processedEpoch, possibleHighRewardValidators);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((p) => p.val_nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountMissPropose.set(
        { nos_name: operator.name },
        operatorResult ? operatorResult.miss_propose_count : 0,
      );
    });
  }
}
