import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';

@Injectable()
export class SummaryMetrics {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
  ) {}

  public async calculate(epoch: bigint) {
    this.prometheus.epochTime = await this.clClient.getSlotTime(epoch * 32n);
    this.prometheus.epochNumber.set(Number(epoch));
  }
}
