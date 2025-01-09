import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { ClickhouseService } from 'storage';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

const validatorsWithNegativeDeltaCountThreshold = (quantity: number) => {
  return Math.min(quantity / 3, 1000);
};

export class CriticalNegativeDelta extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService, operators: RegistrySourceOperator[]) {
    super(CriticalNegativeDelta.name, config, storage, operators);
  }

  async alertRule(epoch: Epoch): Promise<AlertRuleResult> {
    const result: AlertRuleResult = {};
    const nosStats = await this.storage.getUserNodeOperatorsStats(epoch);
    const negativeValidatorsCount = await this.storage.getValidatorsCountWithNegativeDelta(epoch);
    for (const noStats of nosStats.filter((o) => o.active_ongoing > this.config.get('CRITICAL_ALERTS_MIN_VAL_COUNT'))) {
      const operator = this.operators.find((o) => +noStats.val_nos_module_id == o.module && +noStats.val_nos_id == o.index);
      const negDelta = negativeValidatorsCount.find((a) => +a.val_nos_module_id == operator.module && +a.val_nos_id == operator.index);
      if (!negDelta) continue;
      if (negDelta.amount > validatorsWithNegativeDeltaCountThreshold(noStats.active_ongoing)) {
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
    return {
      startsAt: new Date(this.sendTimestamp).toISOString(),
      endsAt: new Date(new Date(this.sendTimestamp).setMinutes(new Date(this.sendTimestamp).getMinutes() + 2)).toISOString(),
      labels: { alertname: this.alertname, severity: 'critical', ...this.config.get('CRITICAL_ALERTS_ALERTMANAGER_LABELS') },
      annotations: {
        summary: `${Object.values(ruleResult).length} Node Operators with CRITICAL count of validators with negative delta`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.negDelta} of ${r.ongoing}`),
          '\n',
        ),
      },
    };
  }
}
