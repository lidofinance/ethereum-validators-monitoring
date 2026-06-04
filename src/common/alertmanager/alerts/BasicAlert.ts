import { ConfigService } from 'common/config';
import { NOsValidatorsStatusStats } from 'storage/clickhouse';
import { RegistrySourceOperator } from 'validators-registry';

export interface AlertRequestBody {
  startsAt: string;
  endsAt: string;
  labels: {
    [key: string]: string;
  };
  annotations: {
    summary: string;
    description: string;
  };
}

export interface AlertRuleResult<TOperatorAlertRuleResult> {
  [operator: string]: TOperatorAlertRuleResult;
}

export interface PreparedToSendAlert<TOperatorAlertRuleResult> {
  timestamp: number;
  body: AlertRequestBody;
  ruleResult: AlertRuleResult<TOperatorAlertRuleResult>;
}

export interface AlertBodyAnnotations {
  summary: string;
  description: string;
}

export abstract class Alert<TOperatorAlertRuleResult> {
  public readonly alertname: string;
  protected sendTimestamp = 0;
  protected readonly config: ConfigService;
  protected readonly operators: RegistrySourceOperator[];
  protected readonly moduleIndex: number;
  protected readonly nosStats: NOsValidatorsStatusStats[];

  protected constructor(
    name: string,
    config: ConfigService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
  ) {
    this.alertname = name;
    this.config = config;
    this.operators = operators;
    this.moduleIndex = moduleIndex;
    this.nosStats = nosStats;
  }

  alertBody(ruleResult: AlertRuleResult<TOperatorAlertRuleResult>): AlertRequestBody {
    const timestampDate = new Date(this.sendTimestamp);
    const timestampDatePlusTwoMins = new Date(this.sendTimestamp).setMinutes(timestampDate.getMinutes() + 2);

    return {
      startsAt: timestampDate.toISOString(),
      endsAt: new Date(timestampDatePlusTwoMins).toISOString(),
      labels: {
        alertname: this.alertname,
        severity: 'critical',
        nos_module_id: this.moduleIndex.toString(),
        ...this.config.get('CRITICAL_ALERTS_ALERTMANAGER_LABELS'),
      },
      annotations: this.getAlertBodyAnnotations(ruleResult),
    };
  }

  abstract alertRule(): AlertRuleResult<TOperatorAlertRuleResult>;

  abstract sendRule(ruleResult: AlertRuleResult<TOperatorAlertRuleResult>): boolean;

  abstract getAlertBodyAnnotations(ruleResult: AlertRuleResult<TOperatorAlertRuleResult>): AlertBodyAnnotations;

  toSend(): PreparedToSendAlert<TOperatorAlertRuleResult> | undefined {
    const ruleResult = this.alertRule();
    if (this.sendRule(ruleResult)) {
      return { timestamp: this.sendTimestamp, body: this.alertBody(ruleResult), ruleResult };
    }
  }
}
