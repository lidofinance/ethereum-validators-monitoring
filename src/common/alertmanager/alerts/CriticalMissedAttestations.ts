import { Alert, AlertRequestBody, AlertRuleResult } from './BasicAlert';
import { join } from 'lodash';
import { sentAlerts } from '../critical-alerts.service';
import { ConfigService } from '../../config';
import { ClickhouseService } from '../../../storage';

export class CriticalMissedAttestations extends Alert {
  constructor(config: ConfigService, storage: ClickhouseService) {
    super(CriticalMissedAttestations.name, config, storage);
  }

  async alertRule(bySlot: bigint): Promise<AlertRuleResult> {
    const result: AlertRuleResult = {};
    const operators = await this.storage.getLidoNodeOperatorsStats(bySlot);
    const missedAttValidatorsCount = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(
      bySlot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
    );
    for (const operator of operators.filter((o) => o.active_ongoing > this.config.get('CRITICAL_ALERTS_MIN_VAL_COUNT'))) {
      const missedAtt = missedAttValidatorsCount.find((a) => a.nos_name == operator.nos_name);
      if (!missedAtt) continue;
      if (missedAtt.miss_attestation_count > operator.active_ongoing / 3) {
        result[operator.nos_name] = { ongoing: operator.active_ongoing, missedAtt: missedAtt.miss_attestation_count };
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
          operatorResult.missedAtt > (sentAlerts[this.alertname]?.ruleResult[operator]?.missedAtt ?? 0) &&
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
      labels: { alertname: this.alertname, severity: 'critical' },
      annotations: {
        summary: `${
          Object.values(ruleResult).length
        } Node Operators with CRITICAL count of validators with missed attestations in the last ${this.config.get(
          'BAD_ATTESTATION_EPOCHS',
        )} epoch`,
        description: join(
          Object.entries(ruleResult).map(([o, r]) => `${o}: ${r.missedAtt} of ${r.ongoing}`),
          '\n',
        ),
      },
    };
  }
}
