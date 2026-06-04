import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { gweiToEth } from 'common/functions/gweiToEth';
import { NOsValidatorsByConditionAttestationCount, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { AlertBodyAnnotations, AlertRuleResult } from './BasicAlert';
import { FullInclusionChecksAlert } from './FullInclusionChecksAlert';

export interface MissedAttestationsRuleResult {
  activeCount: number;
  missedAttCount: number;
  activeBalance: bigint;
  missedAttBalance: bigint;
}

export class CriticalMissedAttestations extends FullInclusionChecksAlert<
  NOsValidatorsByConditionAttestationCount,
  MissedAttestationsRuleResult
> {
  constructor(
    config: ConfigService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    missedAttValidators: NOsValidatorsByConditionAttestationCount[],
  ) {
    const name = CriticalMissedAttestations.name + 'Module' + moduleIndex;
    super(name, config, operators, moduleIndex, nosStats, missedAttValidators);
  }

  getOperatorAlertRuleResult(
    missedAttestationsStats: NOsValidatorsByConditionAttestationCount,
    noStats: NOsValidatorsStatusStats,
  ): MissedAttestationsRuleResult {
    return {
      activeCount: noStats.active_ongoing,
      missedAttCount: missedAttestationsStats.amount,
      activeBalance: noStats.active_ongoing_balance,
      missedAttBalance: missedAttestationsStats.balance,
    };
  }

  isNumberOfAffectedValidatorsIncreased(operatorName: string, operatorRuleResult: MissedAttestationsRuleResult): boolean {
    const sentAlertRuleResult = sentAlerts[this.alertname]?.ruleResult[operatorName] as MissedAttestationsRuleResult | undefined;

    return (
      operatorRuleResult.missedAttBalance > (sentAlertRuleResult?.missedAttBalance ?? 0) ||
      operatorRuleResult.missedAttCount > (sentAlertRuleResult?.missedAttCount ?? 0)
    );
  }

  getAlertBodyAnnotations(ruleResult: AlertRuleResult<MissedAttestationsRuleResult>): AlertBodyAnnotations {
    return {
      summary: `${
        Object.values(ruleResult).length
      } Node Operators with CRITICAL count of validators with missed attestations in the last ${this.config.get(
        'BAD_ATTESTATION_EPOCHS',
      )} epoch in module ${this.moduleIndex}`,
      description: join(
        Object.entries(ruleResult).map(
          ([o, r]) =>
            `- **${o}** (${r.activeCount} active validators with total balance ${+gweiToEth(r.activeBalance).toFixed(2)} ETH): ${
              r.missedAttCount
            } validators with total balance ${+gweiToEth(r.missedAttBalance).toFixed(2)} ETH missed attestations;`,
        ),
        '\n',
      ),
    };
  }
}
