import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { allSettled } from 'common/functions/allSettled';
import { PrometheusService, TrackTask, setUserOperatorsMetric } from 'common/prometheus';
import { ClickhouseService } from 'storage/clickhouse';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';

enum WithdrawalType {
  Partial = 'partial',
  Full = 'full',
}

@Injectable()
export class WithdrawalsMetrics {
  protected processedEpoch: number;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  @TrackTask('calc-withdrawals-metrics')
  public async calculate(epoch: Epoch) {
    this.logger.log('Calculating withdrawals metrics');
    this.processedEpoch = epoch;
    this.operators = this.registryService.getOperators();
    await allSettled([this.userNodeOperatorsWithdrawalsStats(), this.otherChainWithdrawalsStats()]);
  }

  private async userNodeOperatorsWithdrawalsStats() {
    const data = await this.storage.getUserNodeOperatorsWithdrawalsStats(this.processedEpoch);
    setUserOperatorsMetric(
      this.prometheus.operatorWithdrawalsSum,
      data,
      this.operators,
      { type: WithdrawalType.Partial },
      (item) => item.partial_withdrawn_sum,
    );
    setUserOperatorsMetric(
      this.prometheus.operatorWithdrawalsSum,
      data,
      this.operators,
      { type: WithdrawalType.Full },
      (item) => item.full_withdrawn_sum,
    );
    setUserOperatorsMetric(
      this.prometheus.operatorWithdrawalsCount,
      data,
      this.operators,
      { type: WithdrawalType.Partial },
      (item) => item.partial_withdrawn_count,
    );
    setUserOperatorsMetric(
      this.prometheus.operatorWithdrawalsCount,
      data,
      this.operators,
      { type: WithdrawalType.Full },
      (item) => item.full_withdrawn_count,
    );
  }

  private async otherChainWithdrawalsStats() {
    const result = await this.storage.getOtherChainWithdrawalsStats(this.processedEpoch);
    this.prometheus.otherChainWithdrawalsSum.set({ type: WithdrawalType.Partial }, result.partial_withdrawn_sum);
    this.prometheus.otherChainWithdrawalsSum.set({ type: WithdrawalType.Full }, result.full_withdrawn_sum);
    this.prometheus.otherChainWithdrawalsCount.set({ type: WithdrawalType.Partial }, result.partial_withdrawn_count);
    this.prometheus.otherChainWithdrawalsCount.set({ type: WithdrawalType.Full }, result.full_withdrawn_count);
  }
}
