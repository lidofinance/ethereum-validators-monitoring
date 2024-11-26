import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { ClickhouseService } from 'storage';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult, AlertRulesResult } from './BasicAlert';

const validatorsWithMissedAttestationCountThreshold = (quantity: number) => {
  return Math.min(quantity / 3, 1000);
};

export class CriticalMissedAttestations extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService, operators: RegistrySourceOperator[]) {
    super(CriticalMissedAttestations.name, config, storage, operators);
  }

  async alertRules(epoch: Epoch): Promise<AlertRulesResult> {
    const criticalAlertsMinValCount = this.config.get('CRITICAL_ALERTS_MIN_VAL_COUNT');
    const csmModuleId = this.config.get('CSM_MODULE_ID');
    const criticalAlertsMinValCSMAbsoluteCount = this.config.get('CRITICAL_ALERTS_MIN_VAL_CSM_ABSOLUTE_COUNT');

    const result: AlertRulesResult = {};
    const nosStats = await this.storage.getUserNodeOperatorsStats(epoch);
    const missedAttValidatorsCount = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(epoch);
    const filteredNosStats = nosStats.filter((o) => (+o.val_nos_module_id === csmModuleId && o.active_ongoing >= criticalAlertsMinValCSMAbsoluteCount) || (+o.val_nos_module_id !== csmModuleId && o.active_ongoing >= criticalAlertsMinValCount));

    for (const noStats of filteredNosStats) {
      const operator = this.operators.find((o) => +noStats.val_nos_module_id === o.module && +noStats.val_nos_id === o.index);
      const missedAtt = missedAttValidatorsCount.find(
        (a) => a.val_nos_id != null && +a.val_nos_module_id === operator.module && +a.val_nos_id === operator.index,
      );

      if (missedAtt == null) continue;

      if (
        (+noStats.val_nos_module_id === csmModuleId && missedAtt.amount >= criticalAlertsMinValCSMAbsoluteCount) ||
        (+noStats.val_nos_module_id !== csmModuleId &&
         missedAtt.amount >= validatorsWithMissedAttestationCountThreshold(noStats.active_ongoing))
      ) {
        if (result[noStats.val_nos_module_id] == null) {
          result[noStats.val_nos_module_id] = {};
        }
        result[noStats.val_nos_module_id][operator.name] = { ongoing: noStats.active_ongoing, missedAtt: missedAtt.amount };
      }
    }

    return result;
  }

  sendRule(moduleId: string, ruleResult: AlertRuleResult): boolean {
    const defaultInterval = 6 * 60 * 60 * 1000; // 6h
    const ifIncreasedInterval = 60 * 60 * 1000; // 1h
    this.sendTimestamp[moduleId] = Date.now();

    if (Object.values(ruleResult).length > 0) {
      const sentAlertsForModule = sentAlerts[this.alertname] != null ? sentAlerts[this.alertname][moduleId] : null;
      const prevSendTimestamp = sentAlertsForModule?.timestamp ?? 0;

      if (this.sendTimestamp[moduleId] - prevSendTimestamp > defaultInterval) return true;

      for (const [operator, operatorResult] of Object.entries(ruleResult)) {
        const missedAtt = sentAlertsForModule?.ruleResult[operator].missedAtt ?? 0;

        // if any operator has increased bad validators count or another bad operator has been added
        if (operatorResult.missedAtt > missedAtt && (this.sendTimestamp[moduleId] - prevSendTimestamp > ifIncreasedInterval)) return true;
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
        } Node Operators with CRITICAL count of validators with missed attestations in the last ${this.config.get(
          'BAD_ATTESTATION_EPOCHS',
        )} epoch in module ${moduleId}`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.missedAtt} of ${r.ongoing}`),
          '\n',
        ),
      },
    };
  }
}
