import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';
import { join }                                     from 'lodash';
import { sentAlerts }                               from '../CriticalAlertsService';
import { Environment }                              from '../../environment/Environment';
import { ClickhouseStorage }                        from '../../storage/ClickhouseStorage';

export class CriticalMissedProposes extends Alert {

  constructor(env: Environment, storage: ClickhouseStorage) {
    super(CriticalMissedProposes.name, env, storage);
  }

  async alertRule(bySlot: bigint): Promise<AlertRuleResult> {
    const result: AlertRuleResult = {};
    const operators = await this.storage.getLidoNodeOperatorsStats(bySlot);
    const proposes = await this.storage.getLidoNodeOperatorsProposesStats(bySlot);
    for (const operator of operators.filter((o) => o.active_ongoing > this.env.CRITICAL_ALERTS_MIN_VAL_COUNT)) {
      const proposeStats = proposes.find(a => a.nos_name == operator.nos_name);
      if (!proposeStats) continue;
      if (proposeStats.missed > proposeStats.all / 3) {
        result[operator.nos_name] = {all: proposeStats.all, missed: proposeStats.missed};
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
        const prevAll = sentAlerts[this.alertname]?.ruleResult[operator]?.all ?? 0;
        const prevMissed = sentAlerts[this.alertname]?.ruleResult[operator]?.missed ?? 0;
        // if math relation of missed to all increased
        if (
          (operatorResult.missed / operatorResult.all) > (prevMissed / prevAll) &&
          this.sendTimestamp - prevSendTimestamp > ifIncreasedInterval
        ) return true;
      }
    }
    return false;
  }

  alertBody(ruleResult: AlertRuleResult): AlertRequestBody {
    return {
      startsAt: new Date(this.sendTimestamp).toISOString(),
      endsAt: new Date(new Date(this.sendTimestamp).setMinutes(new Date(this.sendTimestamp).getMinutes() + 1)).toISOString(),
      labels: {alertname: this.alertname, severity: 'critical'},
      annotations: {
        summary: `${Object.values(ruleResult).length} Node Operators with CRITICAL count of missed proposes in the last 12 hours`,
        description: join(Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.missed} of ${r.all} proposes`), '\n'),
      }
    }
  };
}
