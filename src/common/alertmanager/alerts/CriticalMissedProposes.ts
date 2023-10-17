import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { ClickhouseService } from 'storage';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

const VALIDATORS_WITH_MISSED_PROPOSALS_COUNT_THRESHOLD = 1 / 3;

export class CriticalMissedProposes extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService, operators: RegistrySourceOperator[]) {
    super(CriticalMissedProposes.name, config, storage, operators);
  }

  async alertRule(epoch: Epoch): Promise<AlertRuleResult> {
    const result: AlertRuleResult = {};
    const nosStats = await this.storage.getUserNodeOperatorsStats(epoch);
    const proposes = await this.storage.getUserNodeOperatorsProposesStats(epoch); // ~12h range
    for (const noStats of nosStats.filter((o) => o.active_ongoing > this.config.get('CRITICAL_ALERTS_MIN_VAL_COUNT'))) {
      const operator = this.operators.find((o) => +noStats.val_nos_module_id == o.module && +noStats.val_nos_id == o.index);
      const proposeStats = proposes.find(
        (a) => a.val_nos_id != null && +a.val_nos_module_id == operator.module && +a.val_nos_id == operator.index,
      );
      if (!proposeStats) continue;
      if (proposeStats.missed > proposeStats.all * VALIDATORS_WITH_MISSED_PROPOSALS_COUNT_THRESHOLD) {
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
        // if math relation of missed to all increased
        if (operatorResult.missed / operatorResult.all > prevMissed / prevAll && this.sendTimestamp - prevSendTimestamp > defaultInterval)
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
        summary: `${Object.values(ruleResult).length} Node Operators with CRITICAL count of missed proposes in the last 12 hours`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.missed} of ${r.all} proposes`),
          '\n',
        ),
      },
    };
  }
}
