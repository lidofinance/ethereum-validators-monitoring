import { join } from 'lodash';

import { sentAlerts } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { NOsProposesStats, NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { AlertBodyAnnotations, AlertRuleResult } from './BasicAlert';
import { StandardAlertRuleAlert } from './StandardAlertRuleAlert';

const VALIDATORS_WITH_MISSED_PROPOSALS_COUNT_THRESHOLD = 1 / 3;

export interface MissedProposalsRuleResult {
  all: number;
  missed: number;
}

export class CriticalMissedProposes extends StandardAlertRuleAlert<NOsProposesStats, MissedProposalsRuleResult> {
  constructor(
    config: ConfigService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    proposes: NOsProposesStats[],
  ) {
    const name = CriticalMissedProposes.name + 'Module' + moduleIndex;
    super(name, config, operators, moduleIndex, nosStats, proposes);
  }

  shouldIncludeToAlertRule(proposeStats: NOsProposesStats): boolean {
    return proposeStats.missed >= proposeStats.all * VALIDATORS_WITH_MISSED_PROPOSALS_COUNT_THRESHOLD;
  }

  getOperatorAlertRuleResult(proposeStats: NOsProposesStats): MissedProposalsRuleResult {
    return {
      all: proposeStats.all,
      missed: proposeStats.missed,
    };
  }

  sendRule(ruleResult: AlertRuleResult<MissedProposalsRuleResult>): boolean {
    const defaultInterval = 6 * 60 * 60 * 1000; // 6h
    this.sendTimestamp = Date.now();

    if (Object.values(ruleResult).length > 0) {
      const prevSendTimestamp = sentAlerts[this.alertname]?.timestamp ?? 0;
      for (const [operator, operatorResult] of Object.entries(ruleResult)) {
        const ruleResult = sentAlerts[this.alertname]?.ruleResult[operator] as MissedProposalsRuleResult | undefined;

        const prevAll = ruleResult?.all ?? 0;
        const prevMissed = ruleResult?.missed ?? 0;
        const prevMissedShare = prevAll === 0 ? 0 : prevMissed / prevAll;

        // if math relation of missed to all increased
        if (operatorResult.missed / operatorResult.all > prevMissedShare && this.sendTimestamp - prevSendTimestamp > defaultInterval)
          return true;
      }
    }

    return false;
  }

  getAlertBodyAnnotations(ruleResult: AlertRuleResult<MissedProposalsRuleResult>): AlertBodyAnnotations {
    return {
      summary: `${Object.values(ruleResult).length} Node Operators with CRITICAL count of missed proposals in the last 12 hours in module ${
        this.moduleIndex
      }`,
      description: join(
        Object.entries(ruleResult).map(([o, r]) => `- **${o}**: ${r.missed} of ${r.all} proposals;`),
        '\n',
      ),
    };
  }
}
