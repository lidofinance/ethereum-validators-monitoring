import { join } from 'lodash';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { ClickhouseService } from 'storage';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult, AlertRulesResult } from './BasicAlert';

export class CriticalSlashing extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService, operators: RegistrySourceOperator[]) {
    super(CriticalSlashing.name, config, storage, operators);
  }

  async alertRules(epoch: Epoch): Promise<AlertRulesResult> {
    const result: AlertRulesResult = {};
    const currOperators = await this.storage.getUserNodeOperatorsStats(epoch);
    const prevOperators = await this.storage.getUserNodeOperatorsStats(epoch - 1); // compare with previous epoch

    for (const currOperator of currOperators) {
      const operator = this.operators.find((o) => +currOperator.val_nos_module_id === o.module && +currOperator.val_nos_id === o.index);
      const prevOperator = prevOperators.find((a) => +a.val_nos_module_id === operator.module && +a.val_nos_id === operator.index);

      // if count of slashed validators increased, we should alert about it
      const prevSlashed = prevOperator != null ? prevOperator.slashed : 0;
      if (currOperator.slashed > prevSlashed) {
        if (result[currOperator.val_nos_module_id] == null) {
          result[currOperator.val_nos_module_id] = {};
        }

        result[currOperator.val_nos_module_id][operator.name] = { ongoing: currOperator.active_ongoing, slashed: currOperator.slashed - prevSlashed };
      }
    }

    return result;
  }

  sendRule(moduleId: string, ruleResult: AlertRuleResult): boolean {
    this.sendTimestamp[moduleId] = Date.now();
    return Object.values(ruleResult).length !== 0;
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
        summary: `${Object.values(ruleResult).length} Node Operators with SLASHED validators in module ${moduleId}`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.slashed} of ${r.ongoing}`),
          '\n',
        ),
      },
    };
  }
}
