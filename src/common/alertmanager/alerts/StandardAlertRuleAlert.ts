import { ConfigService } from 'common/config';
import { NOsIdentity, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRuleResult } from './BasicAlert';

export abstract class StandardAlertRuleAlert<
  TConditionedNOsStats extends NOsIdentity,
  TOperatorAlertRuleResult,
> extends Alert<TOperatorAlertRuleResult> {
  protected readonly conditionedNOsStats: TConditionedNOsStats[];

  protected constructor(
    name: string,
    config: ConfigService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    conditionedNOsStats: TConditionedNOsStats[],
  ) {
    super(name, config, operators, moduleIndex, nosStats);
    this.conditionedNOsStats = conditionedNOsStats;
  }

  alertRule(): AlertRuleResult<TOperatorAlertRuleResult> {
    const alertParams = this.config.getCriticalAlertParamForModule(this.moduleIndex);
    const result: AlertRuleResult<TOperatorAlertRuleResult> = {};

    let filteredNosStats: NOsValidatorsStatusStats[];
    if (alertParams.affectedValBalance != null || alertParams.activeValBalance != null) {
      const balanceThreshold = alertParams.affectedValBalance ?? alertParams.activeValBalance.minActiveBalance;
      filteredNosStats = this.nosStats.filter((o) => o.active_ongoing_balance >= balanceThreshold);
    } else {
      const activeOngoingThreshold = alertParams.affectedValCount ?? alertParams.activeValCount.minActiveCount;
      filteredNosStats = this.nosStats.filter((o) => o.active_ongoing >= activeOngoingThreshold);
    }

    for (const noStats of filteredNosStats) {
      const operator = this.operators.find((o) => +noStats.val_nos_id === o.index);
      const conditionedOperator = this.conditionedNOsStats.find(
        (o) => o.val_nos_id != null && +o.val_nos_module_id === operator.module && +o.val_nos_id === operator.index,
      );

      if (conditionedOperator == null) {
        continue;
      }

      if (this.shouldIncludeToAlertRule(conditionedOperator, noStats)) {
        result[operator.name] = this.getOperatorAlertRuleResult(conditionedOperator, noStats);
      }
    }

    return result;
  }

  abstract shouldIncludeToAlertRule(conditionedOperator: TConditionedNOsStats, noStats: NOsValidatorsStatusStats): boolean;

  abstract getOperatorAlertRuleResult(
    conditionedOperator: TConditionedNOsStats,
    noStats: NOsValidatorsStatusStats,
  ): TOperatorAlertRuleResult;
}
