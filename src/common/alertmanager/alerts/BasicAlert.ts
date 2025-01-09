import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { ClickhouseService } from 'storage';
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

  protected constructor(name: string, config: ConfigService, storage: ClickhouseService, operators: RegistrySourceOperator[]) {
    this.alertname = name;
    this.config = config;
    this.storage = storage;
    this.operators = operators;
  }

  abstract alertRule(bySlot: number): Promise<AlertRuleResult>;

  abstract sendRule(ruleResult?: AlertRuleResult): boolean;

  abstract alertBody(ruleResult: AlertRuleResult): AlertRequestBody;

  async toSend(epoch: Epoch): Promise<PreparedToSendAlert | undefined> {
    const ruleResult = await this.alertRule(epoch);
    if (this.sendRule(ruleResult)) return { timestamp: this.sendTimestamp, body: this.alertBody(ruleResult), ruleResult };
  }
}
