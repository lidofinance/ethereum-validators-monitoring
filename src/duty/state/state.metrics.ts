import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { RegistryOperator } from '@lido-nestjs/registry';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { allSettled } from 'common/functions/allSettled';
import { Owner, PrometheusService, PrometheusValStatus, TrackTask, setUserOperatorsMetric } from 'common/prometheus';
import { Epoch } from 'common/types/types';
import { ClickhouseService } from 'storage/clickhouse';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';
import { LidoSourceService } from 'validators-registry/lido-source';

const GWEI_WEI_RATIO = 1e9;
const ETH_GWEI_RATIO = 1e9;

@Injectable()
export class StateMetrics {
  protected processedEpoch: number;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  @TrackTask('calc-state-metrics')
  public async calculate(epoch: Epoch) {
    this.logger.log('Calculating state metrics');
    this.processedEpoch = epoch;
    this.operators = this.registryService.getOperators();
    await allSettled([
      this.operatorsIdentifies(),
      this.nosStats(),
      this.userValidatorsStats(),
      this.otherValidatorsStats(),
      this.avgDeltas(),
      this.minDeltas(),
      this.negativeValidatorsCount(),
      this.totalBalance24hDifference(),
      this.operatorBalance24hDifference(),
      this.contract(),
    ]);
  }

  private async operatorsIdentifies() {
    setUserOperatorsMetric(
      this.prometheus.operatorsIdentifies,
      this.operators.map((operator) => ({ val_nos_id: operator.index, amount: 1 })),
      this.operators,
    );
  }

  private async nosStats() {
    const data = await this.storage.getUserNodeOperatorsStats(this.processedEpoch);
    setUserOperatorsMetric(
      this.prometheus.userValidators,
      data,
      this.operators,
      {
        status: PrometheusValStatus.Ongoing,
      },
      (item) => item.active_ongoing,
    );
    setUserOperatorsMetric(
      this.prometheus.userValidatorsBalance,
      data,
      this.operators,
      {
        status: PrometheusValStatus.Ongoing,
      },
      (item) => gweiToEthBP(item.active_ongoing_balance),
    );
    setUserOperatorsMetric(
      this.prometheus.userValidators,
      data,
      this.operators,
      {
        status: PrometheusValStatus.Pending,
      },
      (item) => item.pending,
    );
    setUserOperatorsMetric(
      this.prometheus.userValidatorsBalance,
      data,
      this.operators,
      {
        status: PrometheusValStatus.Pending,
      },
      (item) => gweiToEthBP(item.pending_balance),
    );
    setUserOperatorsMetric(
      this.prometheus.userValidators,
      data,
      this.operators,
      {
        status: PrometheusValStatus.Slashed,
      },
      (item) => item.slashed,
    );
    setUserOperatorsMetric(
      this.prometheus.userValidatorsBalance,
      data,
      this.operators,
      {
        status: PrometheusValStatus.Slashed,
      },
      (item) => gweiToEthBP(item.slashed_balance),
    );
    setUserOperatorsMetric(
      this.prometheus.userValidators,
      data,
      this.operators,
      {
        status: PrometheusValStatus.WithdrawalPending,
      },
      (item) => item.withdraw_pending,
    );
    setUserOperatorsMetric(
      this.prometheus.userValidatorsBalance,
      data,
      this.operators,
      {
        status: PrometheusValStatus.WithdrawalPending,
      },
      (item) => gweiToEthBP(item.withdraw_pending_balance),
    );
    setUserOperatorsMetric(
      this.prometheus.userValidators,
      data,
      this.operators,
      {
        status: PrometheusValStatus.WithdrawalDone,
      },
      (item) => item.withdrawn,
    );
    setUserOperatorsMetric(
      this.prometheus.userValidatorsBalance,
      data,
      this.operators,
      {
        status: PrometheusValStatus.WithdrawalDone,
      },
      (item) => gweiToEthBP(item.withdrawn_balance),
    );
    setUserOperatorsMetric(
      this.prometheus.userValidators,
      data,
      this.operators,
      {
        status: PrometheusValStatus.Stuck,
      },
      (item) => item.stuck,
    );
    setUserOperatorsMetric(
      this.prometheus.userValidatorsBalance,
      data,
      this.operators,
      {
        status: PrometheusValStatus.Stuck,
      },
      (item) => gweiToEthBP(item.stuck_balance),
    );
  }

  private async userValidatorsStats() {
    const result = await this.storage.getUserValidatorsSummaryStats(this.processedEpoch);
    result.map((r) => {
      this.prometheus.validators.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.Ongoing,
        },
        r.active_ongoing,
      );
      this.prometheus.validatorsBalance.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.Ongoing,
        },
        gweiToEthBP(r.active_ongoing_balance),
      );
      this.prometheus.validators.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.Pending,
        },
        r.pending,
      );
      this.prometheus.validatorsBalance.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.Pending,
        },
        gweiToEthBP(r.pending_balance),
      );
      this.prometheus.validators.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.Slashed,
        },
        r.slashed,
      );
      this.prometheus.validatorsBalance.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.Slashed,
        },
        gweiToEthBP(r.slashed_balance),
      );
      this.prometheus.validators.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.WithdrawalPending,
        },
        r.withdraw_pending,
      );
      this.prometheus.validatorsBalance.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.WithdrawalPending,
        },
        gweiToEthBP(r.withdraw_pending_balance),
      );
      this.prometheus.validators.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.WithdrawalDone,
        },
        r.withdrawn,
      );
      this.prometheus.validatorsBalance.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.WithdrawalDone,
        },
        gweiToEthBP(r.withdrawn_balance),
      );
      this.prometheus.validators.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.Stuck,
        },
        r.stuck,
      );
      this.prometheus.validatorsBalance.set(
        {
          owner: Owner.USER,
          nos_module_id: r.val_nos_module_id,
          status: PrometheusValStatus.Stuck,
        },
        gweiToEthBP(r.stuck_balance),
      );
    });
  }

  private async otherValidatorsStats() {
    const result = await this.storage.getOtherValidatorsSummaryStats(this.processedEpoch);
    this.prometheus.validators.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Ongoing,
      },
      result.active_ongoing,
    );
    this.prometheus.validatorsBalance.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Ongoing,
      },
      gweiToEthBP(result.active_ongoing_balance),
    );
    this.prometheus.validators.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Pending,
      },
      result.pending,
    );
    this.prometheus.validatorsBalance.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Pending,
      },
      gweiToEthBP(result.pending_balance),
    );
    this.prometheus.validators.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Slashed,
      },
      result.slashed,
    );
    this.prometheus.validatorsBalance.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Slashed,
      },
      gweiToEthBP(result.slashed_balance),
    );
    this.prometheus.validators.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.WithdrawalPending,
      },
      result.withdraw_pending,
    );
    this.prometheus.validatorsBalance.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.WithdrawalPending,
      },
      gweiToEthBP(result.withdraw_pending_balance),
    );
    this.prometheus.validators.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.WithdrawalDone,
      },
      result.withdrawn,
    );
    this.prometheus.validatorsBalance.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.WithdrawalDone,
      },
      gweiToEthBP(result.withdrawn_balance),
    );
  }

  private async avgDeltas() {
    const data = await this.storage.getAvgValidatorBalanceDelta(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.avgValidatorBalanceDelta, data, this.operators);
  }

  private async minDeltas() {
    const data = await this.storage.getValidatorQuantile0001BalanceDeltas(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorQuantile001BalanceDelta, data, this.operators);
  }

  private async negativeValidatorsCount() {
    const data = await this.storage.getValidatorsCountWithNegativeDelta(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountWithNegativeBalanceDelta, data, this.operators);
    setUserOperatorsMetric(this.prometheus.validatorsBalanceWithNegativeBalanceDelta, data, this.operators, {}, (item) =>
      gweiToEthBP(item.balance),
    );
  }

  private async totalBalance24hDifference() {
    const result = await this.storage.getTotalBalance24hDifference(this.processedEpoch);
    result.forEach((r) => this.prometheus.totalBalance24hDifference.set({ nos_module_id: r.val_nos_module_id }, r.amount));
  }

  private async operatorBalance24hDifference() {
    const data = await this.storage.getOperatorBalance24hDifference(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.operatorBalance24hDifference, data, this.operators);
  }

  private async contract() {
    if (!(this.registryService.source instanceof LidoSourceService)) return;
    this.prometheus.contractKeysTotal.set(
      { type: 'total' },
      (this.operators as any as RegistryOperator[]).reduce((sum, o: RegistryOperator) => sum + o.totalSigningKeys, 0),
    );
    this.prometheus.contractKeysTotal.set(
      { type: 'used' },
      (this.operators as any as RegistryOperator[]).reduce((sum, o: RegistryOperator) => sum + o.usedSigningKeys, 0),
    );
    const bufferedEther = (await this.registryService.source.contract.getBufferedEther()).div(GWEI_WEI_RATIO).div(ETH_GWEI_RATIO);
    this.prometheus.bufferedEther.set(bufferedEther.toNumber());
  }
}

export function gweiToEthBP(num: bigint, precision = 4): number {
  if (!Number.isInteger(precision) || precision < 0 || precision > 5) {
    throw Error(`Precision must be integer between 0 and 5, got ${precision}`);
  }

  const decimalsToRemove = 10n ** BigInt(8 - precision);
  const val = Number(num / decimalsToRemove);
  return Math.round(val / 10);
}
