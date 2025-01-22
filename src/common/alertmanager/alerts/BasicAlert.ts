import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';
import { NOsValidatorsStatusStats } from 'storage/clickhouse/clickhouse.types';
import { RegistrySourceOperator } from 'validators-registry';

export interface AlertRequestBody {
  startsAt: string;
  endsAt: string;
  labels: any;
  annotations: any;
}

export interface PreparedToSendAlert {
  timestamp: number;
  body: AlertRequestBody;
  ruleResult: AlertRuleResult;
}

export interface AlertRuleResult {
  [operator: string]: any;
}

export abstract class Alert {
  public readonly alertname: string;
  protected sendTimestamp = 0;
  protected readonly config: ConfigService;
  protected readonly storage: ClickhouseService;
  protected readonly operators: RegistrySourceOperator[];
  protected readonly moduleIndex: number;
  protected readonly nosStats: NOsValidatorsStatusStats[];

  protected constructor(
    name: string,
    config: ConfigService,
    storage: ClickhouseService,
    operators: RegistrySourceOperator[],
    moduleIndex: number,
    nosStats: NOsValidatorsStatusStats[],
  ) {
    this.alertname = name;
    this.config = config;
    this.storage = storage;
    this.operators = operators;
    this.moduleIndex = moduleIndex;
    this.nosStats = nosStats;
  }

  abstract alertRule(): AlertRuleResult;

  abstract sendRule(ruleResult?: AlertRuleResult): boolean;

  abstract alertBody(ruleResult: AlertRuleResult): AlertRequestBody;

  async toSend(): Promise<PreparedToSendAlert | undefined> {
    const ruleResult = await this.alertRule();
    if (this.sendRule(ruleResult)) return { timestamp: this.sendTimestamp, body: this.alertBody(ruleResult), ruleResult };
  }
}
