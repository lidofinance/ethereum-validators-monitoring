import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { NOsValidatorsCountAndBalance, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { AlertRuleResult } from './BasicAlert';
import { StandardAlertRuleAlert } from './StandardAlertRuleAlert';

export abstract class FullInclusionChecksAlert<
  TConditionedNOsStats extends NOsValidatorsCountAndBalance,
  TOperatorAlertRuleResult,
> extends StandardAlertRuleAlert<TConditionedNOsStats, TOperatorAlertRuleResult> {
  protected constructor(
    name: string,
    config: ConfigService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    conditionedNOsStats: TConditionedNOsStats[],
  ) {
    super(name, config, operators, moduleIndex, nosStats, conditionedNOsStats);
  }

  shouldIncludeToAlertRule(conditionedOperator: TConditionedNOsStats, noStats: NOsValidatorsStatusStats): boolean {
    const alertParams = this.config.getCriticalAlertParamForModule(this.moduleIndex);

    if (alertParams.affectedValBalance != null) {
      return conditionedOperator.balance >= alertParams.affectedValBalance;
    }

    if (alertParams.activeValBalance != null) {
      const percent = Math.round(alertParams.activeValBalance.affectedShare * 1000000);
      const noStatsBalanceShare = (noStats.active_ongoing_balance * BigInt(percent)) / 1000000n;
      const minBalance =
        noStatsBalanceShare <= alertParams.activeValBalance.minAffectedBalance
          ? noStatsBalanceShare
          : alertParams.activeValBalance.minAffectedBalance;

      return conditionedOperator.balance >= minBalance;
    }

    if (alertParams.affectedValCount != null) {
      return conditionedOperator.amount >= alertParams.affectedValCount;
    }

    if (alertParams.activeValCount != null) {
      return (
        conditionedOperator.amount >=
        Math.min(noStats.active_ongoing * alertParams.activeValCount.affectedShare, alertParams.activeValCount.minAffectedCount)
      );
    }

    return false;
  }

  sendRule(ruleResult: AlertRuleResult<TOperatorAlertRuleResult>): boolean {
    const defaultInterval = 21600000; // 6 * 60 * 60 * 1000 = 6h
    const ifIncreasedInterval = 3600000; // 60 * 60 * 1000 = 1h
    this.sendTimestamp = Date.now();

    if (Object.values(ruleResult).length > 0) {
      const prevSendTimestamp = sentAlerts[this.alertname]?.timestamp ?? 0;
      if (this.sendTimestamp - prevSendTimestamp > defaultInterval) {
        return true;
      }

      for (const [operatorName, operatorResult] of Object.entries(ruleResult)) {
        // if any operator has increased bad validators count or balance, or another bad operator has been added
        if (
          this.isNumberOfAffectedValidatorsIncreased(operatorName, operatorResult) &&
          this.sendTimestamp - prevSendTimestamp > ifIncreasedInterval
        ) {
          return true;
        }
      }
    }

    return false;
  }

  abstract isNumberOfAffectedValidatorsIncreased(operatorName: string, operatorRuleResult: TOperatorAlertRuleResult): boolean;
}
