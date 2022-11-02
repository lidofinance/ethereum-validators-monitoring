import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { ClickhouseService } from 'storage';

@Injectable()
export class ProposeMetrics {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  public async calculate(epoch: bigint, possibleHighRewardValidators: string[]) {
    return await this.prometheus.trackTask('calc-propose-metrics', async () => {
      this.logger.log('Calculating propose metrics');
      const operators = await this.registryService.getOperators();
      const missProposes = await this.storage.getValidatorsCountWithMissedProposes(epoch);
      const highRewardMissProposes =
        possibleHighRewardValidators.length > 0
          ? await this.storage.getValidatorsCountWithMissedProposes(epoch, possibleHighRewardValidators)
          : [];
      operators.forEach((operator) => {
        const missPropose = missProposes.find((p) => p.val_nos_name == operator.name);
        this.prometheus.validatorsCountMissPropose.set({ nos_name: operator.name }, missPropose ? missPropose.miss_propose_count : 0);
        const highRewardMissPropose = highRewardMissProposes.find((p) => p.val_nos_name == operator.name);
        this.prometheus.highRewardValidatorsCountMissPropose.set(
          { nos_name: operator.name },
          highRewardMissPropose ? highRewardMissPropose.miss_propose_count : 0,
        );
      });
    });
  }
}
