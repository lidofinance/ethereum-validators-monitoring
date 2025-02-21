import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';
import { NOsValidatorsByConditionAttestationCount, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

export class CriticalMissedAttestations extends Alert {
  protected readonly missedAttValidatorsCount: NOsValidatorsByConditionAttestationCount[];

  constructor(
    config: ConfigService,
    storage: ClickhouseService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    missedAttValidatorsCount: NOsValidatorsByConditionAttestationCount[],
  ) {
    const name = CriticalMissedAttestations.name + 'Module' + moduleIndex;
    super(name, config, storage, operators, moduleIndex, nosStats);

    this.missedAttValidatorsCount = missedAttValidatorsCount;
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
      const missedAtt = this.missedAttValidatorsCount.find(
        (a) => a.val_nos_id != null && +a.val_nos_module_id === operator.module && +a.val_nos_id === operator.index,
      );

      if (missedAtt == null) continue;

      const includeToResult =
        alertParams.affectedValCount != null
          ? missedAtt.amount >= alertParams.affectedValCount
          : missedAtt.amount >=
            Math.min(noStats.active_ongoing * alertParams.activeValCount.affectedShare, alertParams.activeValCount.minAffectedCount);
      if (includeToResult) {
        result[operator.name] = { ongoing: noStats.active_ongoing, missedAtt: missedAtt.amount };
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
          operatorResult.missedAtt > (sentAlerts[this.alertname]?.ruleResult[operator]?.missedAtt ?? 0) &&
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
        summary: `${
          Object.values(ruleResult).length
        } Node Operators with CRITICAL count of validators with missed attestations in the last ${this.config.get(
          'BAD_ATTESTATION_EPOCHS',
        )} epoch in module ${this.moduleIndex}`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.missedAtt} of ${r.ongoing}`),
          '\n',
        ),
      },
    };
  }
}
