import { join } from 'lodash';

import { ConfigService } from 'common/config';
import { RegistrySourceOperator } from 'common/validators-registry';
import { ClickhouseService } from 'storage';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

export class CriticalSlashing extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService, operators: RegistrySourceOperator[]) {
    super(CriticalSlashing.name, config, storage, operators);
  }

  async alertRule(epoch: bigint): Promise<AlertRuleResult> {
    const result: AlertRuleResult = {};
    const currOperators = await this.storage.getUserNodeOperatorsStats(epoch);
    const prevOperators = await this.storage.getUserNodeOperatorsStats(epoch - BigInt(this.config.get('FETCH_INTERVAL_SLOTS'))); // compare with previous epoch
    for (const currOperator of currOperators) {
      const operator = this.operators.find((o) => +currOperator.val_nos_id == o.index);
      const prevOperator = prevOperators.find((a) => a.val_nos_id == currOperator.val_nos_id);
      // if count of slashed validators increased, we should alert about it
      const prevSlashed = prevOperator ? prevOperator.slashed : 0;
      if (currOperator.slashed > prevSlashed) {
        result[operator.name] = { ongoing: currOperator.active_ongoing, slashed: currOperator.slashed - prevSlashed };
      }
    }
    return result;
  }

  sendRule(ruleResult: AlertRuleResult): boolean {
    return !!Object.values(ruleResult).length;
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
