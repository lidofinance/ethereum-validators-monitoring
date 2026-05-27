import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';
import { NOsValidatorsNegDeltaCount, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';
import { gweiToEth } from '../../functions/gweiToEth';

export class CriticalNegativeDelta extends Alert {
  protected readonly negativeValidatorsCount: NOsValidatorsNegDeltaCount[];

  constructor(
    config: ConfigService,
    storage: ClickhouseService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    negativeValidatorsCount: NOsValidatorsNegDeltaCount[],
  ) {
    const name = CriticalNegativeDelta.name + 'Module' + moduleIndex;
    super(name, config, storage, operators, moduleIndex, nosStats);

    this.negativeValidatorsCount = negativeValidatorsCount;
  }

  alertRule(): AlertRuleResult {
    const alertParams = this.config.getCriticalAlertParamForModule(this.moduleIndex);
    const result: AlertRuleResult = {};

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
      const negDelta = this.negativeValidatorsCount.find(
        (a) => +a.val_nos_module_id === operator.module && +a.val_nos_id === operator.index,
      );

      if (negDelta == null) {
        continue;
      }

      let includeToResult = false;
      if (alertParams.affectedValBalance != null) {
        includeToResult = negDelta.balance >= alertParams.affectedValBalance;
      } else if (alertParams.activeValBalance != null) {
        const percent = Math.round(alertParams.activeValBalance.affectedShare * 1000000);
        const noStatsBalanceShare = (noStats.active_ongoing_balance * BigInt(percent)) / 1000000n;
        const minBalance =
          noStatsBalanceShare <= alertParams.activeValBalance.minAffectedBalance
            ? noStatsBalanceShare
            : alertParams.activeValBalance.minAffectedBalance;
        includeToResult = negDelta.balance >= minBalance;
      } else if (alertParams.affectedValCount != null) {
        includeToResult = negDelta.amount >= alertParams.affectedValCount;
      } else if (alertParams.activeValCount != null) {
        includeToResult =
          negDelta.amount >=
          Math.min(noStats.active_ongoing * alertParams.activeValCount.affectedShare, alertParams.activeValCount.minAffectedCount);
      }

      if (includeToResult) {
        result[operator.name] = {
          activeCount: noStats.active_ongoing,
          negDeltaCount: negDelta.amount,
          activeBalance: noStats.active_ongoing_balance,
          negDeltaBalance: negDelta.balance,
        };
      }
    }

    return result;
  }

  sendRule(ruleResult: AlertRuleResult): boolean {
    const defaultInterval = 21600000; // 6 * 60 * 60 * 1000 = 6h
    const ifIncreasedInterval = 3600000; // 60 * 60 * 1000 = 1h
    this.sendTimestamp = Date.now();
    if (Object.values(ruleResult).length > 0) {
      const prevSendTimestamp = sentAlerts[this.alertname]?.timestamp ?? 0;
      if (this.sendTimestamp - prevSendTimestamp > defaultInterval) {
        return true;
      }

      for (const [operatorName, operatorResult] of Object.entries(ruleResult)) {
        // if any operator has increased bad validators count or another bad operator has been added
        if (
          (operatorResult.negDeltaBalance > (sentAlerts[this.alertname]?.ruleResult[operatorName]?.negDeltaBalance ?? 0) ||
            operatorResult.negDeltaCount > (sentAlerts[this.alertname]?.ruleResult[operatorName]?.negDeltaCount ?? 0)) &&
          this.sendTimestamp - prevSendTimestamp > ifIncreasedInterval
        )
          return true;
      }
    }
    return false;
  }

  alertBody(ruleResult: AlertRuleResult): AlertRequestBody {
    const timestampDate = new Date(this.sendTimestamp);
    const timestampDatePlusTwoMins = new Date(this.sendTimestamp).setMinutes(timestampDate.getMinutes() + 2);

    return {
      startsAt: timestampDate.toISOString(),
      endsAt: new Date(timestampDatePlusTwoMins).toISOString(),
      labels: {
        alertname: this.alertname,
        severity: 'critical',
        nos_module_id: this.moduleIndex.toString(),
        ...this.config.get('CRITICAL_ALERTS_ALERTMANAGER_LABELS'),
      },
      annotations: {
        summary: `${Object.values(ruleResult).length} Node Operators with CRITICAL count of validators with negative delta in module ${
          this.moduleIndex
        }`,
        description: join(
          Object.entries(ruleResult).map(
            ([o, r]) =>
              `- **${o}** (${r.activeCount} active validators with total balance ${+gweiToEth(r.activeBalance).toFixed(2)} ETH): ${
                r.negDeltaCount
              } validators with total balance ${+gweiToEth(r.negDeltaBalance).toFixed(2)} ETH have negative balance delta;`,
          ),
          '\n',
        ),
      },
    };
  }
}
