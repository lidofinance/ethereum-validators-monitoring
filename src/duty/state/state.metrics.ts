import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { RegistryOperator } from '@lido-nestjs/registry';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Owner, PrometheusService, PrometheusValStatus } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { LidoSourceService } from 'common/validators-registry/lido-source';
import { ClickhouseService } from 'storage/clickhouse';

const GWEI_WEI_RATIO = 1e9;

@Injectable()
export class StateMetrics {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  public async calculate(epoch: bigint) {
    const operators = await this.registryService.getOperators();

    const nosStats = await this.storage.getUserNodeOperatorsStats(epoch);
    for (const nosStat of nosStats) {
      this.prometheus.userValidators.set({ nos_name: nosStat.val_nos_name, status: PrometheusValStatus.Slashed }, nosStat.slashed);
      this.prometheus.userValidators.set({ nos_name: nosStat.val_nos_name, status: PrometheusValStatus.Ongoing }, nosStat.active_ongoing);
      this.prometheus.userValidators.set({ nos_name: nosStat.val_nos_name, status: PrometheusValStatus.Pending }, nosStat.pending);
    }

    const userValidatorsStats = await this.storage.getUserValidatorsSummaryStats(epoch);
    this.logger.log(`User ongoing validators [${userValidatorsStats.active_ongoing}]`);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Slashed }, userValidatorsStats.slashed);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Ongoing }, userValidatorsStats.active_ongoing);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Pending }, userValidatorsStats.pending);

    const otherValidatorsStats = await this.storage.getOtherValidatorsSummaryStats(epoch);
    this.logger.log(`Other ongoing validators [${otherValidatorsStats.active_ongoing}]`);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Ongoing }, otherValidatorsStats.active_ongoing);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Pending }, otherValidatorsStats.pending);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Slashed }, otherValidatorsStats.slashed);

    const deltas = await this.storage.getValidatorBalancesDelta(epoch);
    for (const delta of deltas) {
      this.prometheus.validatorBalanceDelta.set({ nos_name: delta.val_nos_name }, delta.delta);
    }

    const minDeltas = await this.storage.getValidatorQuantile0001BalanceDeltas(epoch);
    for (const minDelta of minDeltas) {
      this.prometheus.validatorQuantile001BalanceDelta.set({ nos_name: minDelta.val_nos_name }, minDelta.delta);
    }

    const negativeValidatorsCount = await this.storage.getValidatorsCountWithNegativeDelta(epoch);
    operators.forEach((operator) => {
      const negDelta = negativeValidatorsCount.find((d) => d.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithNegativeBalanceDelta.set({ nos_name: operator.name }, negDelta ? negDelta.neg_count : 0);
    });

    const totalBalance24hDifference = await this.storage.getTotalBalance24hDifference(epoch);
    if (totalBalance24hDifference != undefined) {
      this.prometheus.totalBalance24hDifference.set(totalBalance24hDifference);
    }
    const operatorBalance24hDifference = await this.storage.getOperatorBalance24hDifference(epoch);
    operatorBalance24hDifference.forEach((d) => {
      this.prometheus.operatorBalance24hDifference.set({ nos_name: d.nos_name }, d.diff);
    });

    if (this.registryService.source instanceof LidoSourceService) {
      this.prometheus.contractKeysTotal.set(
        { type: 'total' },
        operators.reduce((sum, o: RegistryOperator) => sum + o.totalSigningKeys, 0),
      );
      this.prometheus.contractKeysTotal.set(
        { type: 'used' },
        operators.reduce((sum, o: RegistryOperator) => sum + o.usedSigningKeys, 0),
      );
      // only for operators with 0 used keys
      operators.forEach((operator: RegistryOperator) => {
        if (operator.usedSigningKeys == 0) {
          this.prometheus.userValidators.set({ nos_name: operator.name, status: PrometheusValStatus.Ongoing }, 0);
        }
      });

      const bufferedEther = (await this.registryService.source.contract.getBufferedEther()).div(GWEI_WEI_RATIO).div(GWEI_WEI_RATIO);
      this.prometheus.bufferedEther.set(bufferedEther.toNumber());
    }
  }
}
