import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { RegistryOperator } from '@lido-nestjs/registry';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Owner, PrometheusService, PrometheusValStatus } from 'common/prometheus';
import { RegistryService, RegistrySourceOperator } from 'common/validators-registry';
import { LidoSourceService } from 'common/validators-registry/lido-source';
import { ClickhouseService } from 'storage/clickhouse';

const GWEI_WEI_RATIO = 1e9;

@Injectable()
export class StateMetrics {
  protected epoch: bigint;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  public async calculate(epoch: bigint) {
    return await this.prometheus.trackTask('calc-state-metrics', async () => {
      this.logger.log('Calculating state metrics');
      this.epoch = epoch;
      this.operators = await this.registryService.getOperators();
      await Promise.all([
        this.nosStats(),
        this.userValidatorsStats(),
        this.otherValidatorsStats(),
        this.deltas(),
        this.minDeltas(),
        this.negativeValidatorsCount(),
        this.totalBalance24hDifference(),
        this.operatorBalance24hDifference(),
        this.contract(),
      ]);
    });
  }

  private async nosStats() {
    const result = await this.storage.getUserNodeOperatorsStats(this.epoch);
    for (const nosStat of result) {
      this.prometheus.userValidators.set(
        {
          nos_name: nosStat.val_nos_name,
          status: PrometheusValStatus.Slashed,
        },
        nosStat.slashed,
      );
      this.prometheus.userValidators.set(
        {
          nos_name: nosStat.val_nos_name,
          status: PrometheusValStatus.Ongoing,
        },
        nosStat.active_ongoing,
      );
      this.prometheus.userValidators.set(
        {
          nos_name: nosStat.val_nos_name,
          status: PrometheusValStatus.Pending,
        },
        nosStat.pending,
      );
    }
  }

  private async userValidatorsStats() {
    const result = await this.storage.getUserValidatorsSummaryStats(this.epoch);
    this.logger.log(`User ongoing validators [${result.active_ongoing}]`);
    this.prometheus.validators.set(
      {
        owner: Owner.USER,
        status: PrometheusValStatus.Slashed,
      },
      result.slashed,
    );
    this.prometheus.validators.set(
      {
        owner: Owner.USER,
        status: PrometheusValStatus.Ongoing,
      },
      result.active_ongoing,
    );
    this.prometheus.validators.set(
      {
        owner: Owner.USER,
        status: PrometheusValStatus.Pending,
      },
      result.pending,
    );
  }

  private async otherValidatorsStats() {
    const result = await this.storage.getOtherValidatorsSummaryStats(this.epoch);
    this.logger.log(`Other ongoing validators [${result.active_ongoing}]`);
    this.prometheus.validators.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Ongoing,
      },
      result.active_ongoing,
    );
    this.prometheus.validators.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Pending,
      },
      result.pending,
    );
    this.prometheus.validators.set(
      {
        owner: Owner.OTHER,
        status: PrometheusValStatus.Slashed,
      },
      result.slashed,
    );
  }

  private async deltas() {
    const result = await this.storage.getValidatorBalancesDelta(this.epoch);
    for (const delta of result) {
      this.prometheus.validatorBalanceDelta.set({ nos_name: delta.val_nos_name }, delta.delta);
    }
  }

  private async minDeltas() {
    const result = await this.storage.getValidatorQuantile0001BalanceDeltas(this.epoch);
    for (const minDelta of result) {
      this.prometheus.validatorQuantile001BalanceDelta.set({ nos_name: minDelta.val_nos_name }, minDelta.delta);
    }
  }

  private async negativeValidatorsCount() {
    const result = await this.storage.getValidatorsCountWithNegativeDelta(this.epoch);
    this.operators.forEach((operator) => {
      const negDelta = result.find((d) => d.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithNegativeBalanceDelta.set({ nos_name: operator.name }, negDelta ? negDelta.neg_count : 0);
    });
  }

  private async totalBalance24hDifference() {
    const result = await this.storage.getTotalBalance24hDifference(this.epoch);
    if (result != undefined) {
      this.prometheus.totalBalance24hDifference.set(result);
    }
  }

  private async operatorBalance24hDifference() {
    const result = await this.storage.getOperatorBalance24hDifference(this.epoch);
    result.forEach((d) => {
      this.prometheus.operatorBalance24hDifference.set({ nos_name: d.nos_name }, d.diff);
    });
  }

  private async contract() {
    if (this.registryService.source instanceof LidoSourceService) {
      this.prometheus.contractKeysTotal.set(
        { type: 'total' },
        this.operators.reduce((sum, o: RegistryOperator) => sum + o.totalSigningKeys, 0),
      );
      this.prometheus.contractKeysTotal.set(
        { type: 'used' },
        this.operators.reduce((sum, o: RegistryOperator) => sum + o.usedSigningKeys, 0),
      );
      // only for operators with 0 used keys
      this.operators.forEach((operator: RegistryOperator) => {
        if (operator.usedSigningKeys == 0) {
          this.prometheus.userValidators.set({ nos_name: operator.name, status: PrometheusValStatus.Ongoing }, 0);
        }
      });

      const bufferedEther = (await this.registryService.source.contract.getBufferedEther()).div(GWEI_WEI_RATIO).div(GWEI_WEI_RATIO);
      this.prometheus.bufferedEther.set(bufferedEther.toNumber());
    }
  }
}
