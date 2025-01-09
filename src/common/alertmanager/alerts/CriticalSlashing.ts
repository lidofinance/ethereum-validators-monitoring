import { join } from 'lodash';

import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';
import { NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';

export class CriticalSlashing extends Alert {
  protected readonly prevNosStats: NOsValidatorsStatusStats[];

  constructor(
    config: ConfigService,
    storage: ClickhouseService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    prevNosStats: NOsValidatorsStatusStats[],
  ) {
    const name = CriticalSlashing.name + 'Module' + moduleIndex;
    super(name, config, storage, operators, moduleIndex, nosStats);

    this.prevNosStats = prevNosStats;
  }

  async alertRule(): Promise<AlertRuleResult> {
    const result: AlertRuleResult = {};

    for (const currOperator of this.nosStats) {
      const operator = this.operators.find((o) => +currOperator.val_nos_id === o.index);
      const prevOperator = this.prevNosStats.find((a) => +a.val_nos_module_id === operator.module && +a.val_nos_id === operator.index);

      // if count of slashed validators increased, we should alert about it
      const prevSlashed = prevOperator != null ? prevOperator.slashed : 0;
      if (currOperator.slashed > prevSlashed) {
        result[operator.name] = { ongoing: currOperator.active_ongoing, slashed: currOperator.slashed - prevSlashed };
      }
    }

    return result;
  }

  sendRule(ruleResult: AlertRuleResult): boolean {
    this.sendTimestamp = Date.now();
    return !!Object.values(ruleResult).length;
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
        nos_module_id: this.moduleIndex,
        ...this.config.get('CRITICAL_ALERTS_ALERTMANAGER_LABELS'),
      },
      annotations: {
        summary: `${Object.values(ruleResult).length} Node Operators with SLASHED validators in module ${this.moduleIndex}`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.slashed} of ${r.ongoing}`),
          '\n',
        ),
      },
    };
  }
}
