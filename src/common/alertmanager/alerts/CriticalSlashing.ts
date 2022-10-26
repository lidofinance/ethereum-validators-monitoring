import { join } from 'lodash';

import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

export class CriticalSlashing extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService) {
    super(CriticalSlashing.name, config, storage);
  }

  async alertRule(bySlot: bigint): Promise<AlertRuleResult> {
    const result: AlertRuleResult = {};
    const currOperators = await this.storage.getUserNodeOperatorsStats(bySlot);
    const prevOperators = await this.storage.getUserNodeOperatorsStats(bySlot - BigInt(this.config.get('FETCH_INTERVAL_SLOTS'))); // compare with previous epoch
    for (const currOperator of currOperators.filter((o) => o.active_ongoing > this.config.get('CRITICAL_ALERTS_MIN_VAL_COUNT'))) {
      const prevOperator = prevOperators.find((a) => a.nos_name == currOperator.nos_name);
      // if count of slashed validators increased, we should alert about it
      const prevSlashed = prevOperator ? prevOperator.slashed : 0;
      if (currOperator.slashed > prevSlashed) {
        result[currOperator.nos_name] = { ongoing: currOperator.active_ongoing, slashed: currOperator.slashed - prevSlashed };
      }
    }
    return result;
  }

  sendRule(): boolean {
    return true;
  }

  alertBody(ruleResult: AlertRuleResult): AlertRequestBody {
    return {
      startsAt: new Date(this.sendTimestamp).toISOString(),
      endsAt: new Date(new Date(this.sendTimestamp).setMinutes(new Date(this.sendTimestamp).getMinutes() + 1)).toISOString(),
      labels: { alertname: this.alertname, severity: 'critical', ...this.config.get('CRITICAL_ALERTS_ALERTMANAGER_LABELS') },
      annotations: {
        summary: `${Object.values(ruleResult).length} Node Operators with SLASHED validators`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.slashed} of ${r.ongoing}`),
          '\n',
        ),
      },
    };
  }
}
