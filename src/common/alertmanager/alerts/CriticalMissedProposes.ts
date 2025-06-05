import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';
import { NOsProposesStats, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

const VALIDATORS_WITH_MISSED_PROPOSALS_COUNT_THRESHOLD = 1 / 3;

export class CriticalMissedProposes extends Alert {
  protected readonly proposes: NOsProposesStats[];

  constructor(
    config: ConfigService,
    storage: ClickhouseService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    proposes: NOsProposesStats[],
  ) {
    const name = CriticalMissedProposes.name + 'Module' + moduleIndex;
    super(name, config, storage, operators, moduleIndex, nosStats);

    this.proposes = proposes;
  }

  alertRule(): AlertRuleResult {
    const alertParams = this.config.getCriticalAlertParamForModule(this.moduleIndex);
    const result: AlertRuleResult = {};

    const activeOngoingThreshold = alertParams.affectedValCount ?? alertParams.activeValCount.minActiveCount;
    const filteredNosStats = this.nosStats.filter((o) => o.active_ongoing >= activeOngoingThreshold);

    for (const noStats of filteredNosStats) {
      const operator = this.operators.find((o) => +noStats.val_nos_id === o.index);
      const proposeStats = this.proposes.find(
        (a) => a.val_nos_id != null && +a.val_nos_module_id === operator.module && +a.val_nos_id === operator.index,
      );

      if (proposeStats == null) continue;

      if (proposeStats.missed >= proposeStats.all * VALIDATORS_WITH_MISSED_PROPOSALS_COUNT_THRESHOLD) {
        result[operator.name] = { all: proposeStats.all, missed: proposeStats.missed };
      }
    }

    return result;
  }

  sendRule(ruleResult: AlertRuleResult): boolean {
    const defaultInterval = 6 * 60 * 60 * 1000; // 6h
    this.sendTimestamp = Date.now();
    if (Object.values(ruleResult).length > 0) {
      const prevSendTimestamp = sentAlerts[this.alertname]?.timestamp ?? 0;
      for (const [operator, operatorResult] of Object.entries(ruleResult)) {
        const prevAll = sentAlerts[this.alertname]?.ruleResult[operator]?.all ?? 0;
        const prevMissed = sentAlerts[this.alertname]?.ruleResult[operator]?.missed ?? 0;
        const prevMissedShare = prevAll === 0 ? 0 : prevMissed / prevAll;

        // if math relation of missed to all increased
        if (operatorResult.missed / operatorResult.all > prevMissedShare && this.sendTimestamp - prevSendTimestamp > defaultInterval)
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
        summary: `${
          Object.values(ruleResult).length
        } Node Operators with CRITICAL count of missed proposals in the last 12 hours in module ${this.moduleIndex}`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.missed} of ${r.all} proposals`),
          '\n',
        ),
      },
    };
  }
}
