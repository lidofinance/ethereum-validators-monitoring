import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

export class CriticalNegativeDelta extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService) {
    super(CriticalNegativeDelta.name, config, storage);
  }

  async alertRule(bySlot: bigint): Promise<AlertRuleResult> {
    const result: AlertRuleResult = {};
    const operators = await this.storage.getUserNodeOperatorsStats(bySlot);
    const negativeValidatorsCount = await this.storage.getValidatorsCountWithNegativeDelta(bySlot);
    for (const operator of operators.filter((o) => o.active_ongoing > this.config.get('CRITICAL_ALERTS_MIN_VAL_COUNT'))) {
      const negDelta = negativeValidatorsCount.find((a) => a.nos_name == operator.nos_name);
      if (!negDelta) continue;
      if (negDelta.neg_count > operator.active_ongoing / 3) {
        result[operator.nos_name] = { ongoing: operator.active_ongoing, negDelta: negDelta.neg_count };
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
      endsAt: new Date(new Date(this.sendTimestamp).setMinutes(new Date(this.sendTimestamp).getMinutes() + 1)).toISOString(),
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
