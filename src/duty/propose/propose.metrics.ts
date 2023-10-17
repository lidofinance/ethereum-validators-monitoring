import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { allSettled } from 'common/functions/allSettled';
import { PrometheusService, TrackTask, setOtherOperatorsMetric, setUserOperatorsMetric } from 'common/prometheus';
import { ClickhouseService } from 'storage';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';

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
    await allSettled([this.goodProposes(), this.missProposes(), this.highRewardMissProposes(possibleHighRewardValidators)]);
  }

  private async goodProposes() {
    const data = await this.storage.getValidatorsCountWithGoodProposes(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountGoodPropose, data, this.operators);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountGoodPropose, data);
  }

  private async missProposes() {
    const data = await this.storage.getValidatorsCountWithMissedProposes(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountMissPropose, data, this.operators);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountMissPropose, data);
  }

  private async highRewardMissProposes(possibleHighRewardValidators: string[]) {
    if (possibleHighRewardValidators.length > 0) {
      const data = await this.storage.getValidatorsCountWithMissedProposes(this.processedEpoch, possibleHighRewardValidators);
      setUserOperatorsMetric(this.prometheus.highRewardValidatorsCountMissPropose, data, this.operators);
    }
  }
}
