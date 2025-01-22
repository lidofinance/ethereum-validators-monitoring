import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';
import { NOsValidatorsNegDeltaCount, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

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

    const activeOngoingThreshold = alertParams.affectedValCount ?? alertParams.activeValCount.minActiveCount;

    // If affectedValCount is set, we're not interested in NOs with a number of validators less than this value
    // (because for these NOs it is not possible to have a number of affected validators greater than this value).
    const filteredNosStats = this.nosStats.filter((o) => o.active_ongoing >= activeOngoingThreshold);

    for (const noStats of filteredNosStats) {
      const operator = this.operators.find((o) => +noStats.val_nos_id === o.index);
      const negDelta = this.negativeValidatorsCount.find(
        (a) => +a.val_nos_module_id === operator.module && +a.val_nos_id === operator.index,
      );

      if (negDelta == null) continue;

      const includeToResult =
        alertParams.affectedValCount != null
          ? negDelta.amount >= alertParams.affectedValCount
          : negDelta.amount >=
            Math.min(noStats.active_ongoing * alertParams.activeValCount.affectedShare, alertParams.activeValCount.minAffectedCount);
      if (includeToResult) {
        result[operator.name] = { ongoing: noStats.active_ongoing, negDelta: negDelta.amount };
      }
    }

    return result;
  }

  sendRule(ruleResult: AlertRuleResult): boolean {
    const defaultInterval = 6 * 60 * 60 * 1000; // 6h
    const ifIncreasedInterval = 60 * 60 * 1000; // 1h
    this.sendTimestamp = Date.now();
    if (Object.values(ruleResult).length > 0) {
      const prevSendTimestamp = sentAlerts[this.alertname]?.timestamp ?? 0;
      if (this.sendTimestamp - prevSendTimestamp > defaultInterval) return true;
      for (const [operator, operatorResult] of Object.entries(ruleResult)) {
        // if any operator has increased bad validators count or another bad operator has been added
        if (
          operatorResult.negDelta > (sentAlerts[this.alertname]?.ruleResult[operator]?.negDelta ?? 0) &&
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
        nos_module_id: this.moduleIndex,
        ...this.config.get('CRITICAL_ALERTS_ALERTMANAGER_LABELS'),
      },
      annotations: {
        summary: `${Object.values(ruleResult).length} Node Operators with CRITICAL count of validators with negative delta in module ${
          this.moduleIndex
        }`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.negDelta} of ${r.ongoing}`),
          '\n',
        ),
      },
    };
  }
}
