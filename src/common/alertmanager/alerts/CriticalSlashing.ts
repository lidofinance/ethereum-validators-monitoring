import { join } from 'lodash';

import { ConfigService } from 'common/config';
import { gweiToEth } from 'common/functions/gweiToEth';
import { NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

import { Alert, AlertBodyAnnotations, AlertRuleResult } from './BasicAlert';

export interface SlashingRuleResult {
  activeCount: number;
  slashedCount: number;
  activeBalance: bigint;
  slashedBalance: bigint;
}

export class CriticalSlashing extends Alert<SlashingRuleResult> {
  protected readonly prevNosStats: NOsValidatorsStatusStats[];

  constructor(
    config: ConfigService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
    prevNosStats: NOsValidatorsStatusStats[],
  ) {
    const name = CriticalSlashing.name + 'Module' + moduleIndex;
    super(name, config, operators, moduleIndex, nosStats);

    this.prevNosStats = prevNosStats;
  }

  alertRule(): AlertRuleResult<SlashingRuleResult> {
    const result: AlertRuleResult<SlashingRuleResult> = {};

    for (const currOperator of this.nosStats) {
      const operator = this.operators.find((o) => +currOperator.val_nos_id === o.index);
      const prevOperator = this.prevNosStats.find((o) => +o.val_nos_module_id === operator.module && +o.val_nos_id === operator.index);

      // if count of slashed validators increased, we should alert about it
      const prevSlashed = prevOperator?.slashed ?? 0;
      const prevSlashedBalance = prevOperator?.slashed_balance ?? BigInt(0);
      if (currOperator.slashed > prevSlashed) {
        result[operator.name] = {
          activeCount: currOperator.active_ongoing,
          slashedCount: currOperator.slashed - prevSlashed,
          activeBalance: currOperator.active_ongoing_balance,
          slashedBalance: currOperator.slashed_balance - prevSlashedBalance,
        };
      }
    }

    return result;
  }

  sendRule(ruleResult: AlertRuleResult<SlashingRuleResult>): boolean {
    this.sendTimestamp = Date.now();
    return Object.values(ruleResult).length > 0;
  }

  getAlertBodyAnnotations(ruleResult: AlertRuleResult<SlashingRuleResult>): AlertBodyAnnotations {
    return {
      summary: `${Object.values(ruleResult).length} Node Operators with SLASHED validators in module ${this.moduleIndex}`,
      description: join(
        Object.entries(ruleResult).map(
          ([o, r]) =>
            `- **${o}** ${r.slashedCount} of ${r.activeCount} (${gweiToEth(r.slashedBalance, 0)} ETH of ${gweiToEth(
              r.activeBalance,
              0,
            )} ETH);`,
        ),
        '\n',
      ),
    };
  }
}
