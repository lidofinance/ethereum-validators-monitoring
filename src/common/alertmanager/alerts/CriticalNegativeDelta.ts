import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { gweiToEth } from 'common/functions/gweiToEth';
import { NOsValidatorsNegDeltaCount, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { AlertBodyAnnotations, AlertRuleResult } from './BasicAlert';
import { FullInclusionChecksAlert } from './FullInclusionChecksAlert';

export interface NegativeBalanceDeltaRuleResult {
  activeCount: number;
  negDeltaCount: number;
  activeBalance: bigint;
  negDeltaBalance: bigint;
}

export class CriticalNegativeDelta extends FullInclusionChecksAlert<NOsValidatorsNegDeltaCount, NegativeBalanceDeltaRuleResult> {
  constructor(
    config: ConfigService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    negativeValidatorsCount: NOsValidatorsNegDeltaCount[],
  ) {
    const name = CriticalNegativeDelta.name + 'Module' + moduleIndex;
    super(name, config, operators, moduleIndex, nosStats, negativeValidatorsCount);
  }

  getOperatorAlertRuleResult(negDeltaStats: NOsValidatorsNegDeltaCount, noStats: NOsValidatorsStatusStats): NegativeBalanceDeltaRuleResult {
    return {
      activeCount: noStats.active_ongoing,
      negDeltaCount: negDeltaStats.amount,
      activeBalance: noStats.active_ongoing_balance,
      negDeltaBalance: negDeltaStats.balance,
    };
  }

  isNumberOfAffectedValidatorsIncreased(operatorName: string, operatorRuleResult: NegativeBalanceDeltaRuleResult): boolean {
    const sentAlertRuleResult = sentAlerts[this.alertname]?.ruleResult[operatorName] as NegativeBalanceDeltaRuleResult | undefined;

    return (
      operatorRuleResult.negDeltaBalance > (sentAlertRuleResult?.negDeltaBalance ?? 0) ||
      operatorRuleResult.negDeltaCount > (sentAlertRuleResult?.negDeltaCount ?? 0)
    );
  }

  getAlertBodyAnnotations(ruleResult: AlertRuleResult<NegativeBalanceDeltaRuleResult>): AlertBodyAnnotations {
    return {
      summary: `${Object.values(ruleResult).length} Node Operators with CRITICAL count of validators with negative delta in module ${
        this.moduleIndex
      }`,
      description: join(
        Object.entries(ruleResult).map(
          ([o, r]) =>
            `- **${o}** (${r.activeCount} active validators with total balance ${+gweiToEth(r.activeBalance).toFixed(2)} ETH): ${
              r.negDeltaCount
            } validators with total balance ${+gweiToEth(r.negDeltaBalance).toFixed(2)} ETH have negative balance delta;`,
        ),
        '\n',
      ),
    };
  }
}
