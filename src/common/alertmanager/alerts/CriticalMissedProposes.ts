import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { ClickhouseService } from 'storage';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult, AlertRulesResult } from './BasicAlert';

const VALIDATORS_WITH_MISSED_PROPOSALS_COUNT_THRESHOLD = 1 / 3;

export class CriticalMissedProposes extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService, operators: RegistrySourceOperator[]) {
    super(CriticalMissedProposes.name, config, storage, operators);
  }

  async alertRules(epoch: Epoch): Promise<AlertRulesResult> {
    const criticalAlertsMinValCount = this.config.get('CRITICAL_ALERTS_MIN_VAL_COUNT');
    const csmModuleId = this.config.get('CSM_MODULE_ID');

    const result: AlertRulesResult = {};
    const nosStats = await this.storage.getUserNodeOperatorsStats(epoch);
    const proposes = await this.storage.getUserNodeOperatorsProposesStats(epoch); // ~12h range
    const filteredNosStats = nosStats.filter((o) => +o.val_nos_module_id === csmModuleId || o.active_ongoing >= criticalAlertsMinValCount);

    for (const noStats of filteredNosStats) {
      const operator = this.operators.find((o) => +noStats.val_nos_module_id === o.module && +noStats.val_nos_id === o.index);
      const proposeStats = proposes.find(
        (a) => a.val_nos_id != null && +a.val_nos_module_id === operator.module && +a.val_nos_id === operator.index,
      );

      if (proposeStats == null) continue;

      if (proposeStats.missed >= proposeStats.all * VALIDATORS_WITH_MISSED_PROPOSALS_COUNT_THRESHOLD) {
        if (result[noStats.val_nos_module_id] == null) {
          result[noStats.val_nos_module_id] = {};
        }
        result[noStats.val_nos_module_id][operator.name] = { all: proposeStats.all, missed: proposeStats.missed };
      }
    }

    return result;
  }

  sendRule(moduleId: string, ruleResult: AlertRuleResult): boolean {
    const defaultInterval = 6 * 60 * 60 * 1000; // 6h
    this.sendTimestamp[moduleId] = Date.now();

    if (Object.values(ruleResult).length > 0) {
      const sentAlertsForModule = sentAlerts[this.alertname] != null ? sentAlerts[this.alertname][moduleId] : null;
      const prevSendTimestamp = sentAlertsForModule?.timestamp ?? 0;

      for (const [operator, operatorResult] of Object.entries(ruleResult)) {
        const prevAll = sentAlertsForModule?.ruleResult[operator].all ?? 0;
        const prevMissed = sentAlertsForModule?.ruleResult[operator].missed ?? 0;
        const prevMissedShare = prevAll === 0 ? 0 : prevMissed / prevAll;

        // if math relation of missed to all increased
        if ((operatorResult.missed / operatorResult.all > prevMissedShare) && (this.sendTimestamp[moduleId] - prevSendTimestamp > defaultInterval))
          return true;
      }
    }

    return false;
  }

  alertBody(moduleId: string, ruleResult: AlertRuleResult): AlertRequestBody {
    const timestampDate = new Date(this.sendTimestamp[moduleId]);
    const timestampDatePlusTwoMins = new Date(this.sendTimestamp[moduleId]).setMinutes(timestampDate.getMinutes() + 2);

    return {
      startsAt: timestampDate.toISOString(),
      endsAt: new Date(timestampDatePlusTwoMins).toISOString(),
      labels: {
        alertname: this.alertname,
        severity: 'critical',
        nos_module_id: moduleId,
        ...this.config.get('CRITICAL_ALERTS_ALERTMANAGER_LABELS'),
      },
      annotations: {
        summary: `${
          Object.values(ruleResult).length
        } Node Operators with CRITICAL count of missed proposes in the last 12 hours in module ${moduleId}`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.missed} of ${r.all} proposes`),
          '\n',
        ),
      },
    };
  }
}
