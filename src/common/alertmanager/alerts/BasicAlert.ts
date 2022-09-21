import { ConfigService } from 'common/config';
import { ClickhouseService } from 'storage';

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

  protected constructor(name: string, config: ConfigService, storage: ClickhouseService) {
    this.alertname = name;
    this.config = config;
    this.storage = storage;
  }

  abstract alertRule(bySlot: bigint): Promise<AlertRuleResult>;

  abstract sendRule(ruleResult?: AlertRuleResult): boolean;

  abstract alertBody(ruleResult: AlertRuleResult): AlertRequestBody;

  async toSend(bySlot: bigint): Promise<PreparedToSendAlert | undefined> {
    const ruleResult = await this.alertRule(bySlot);
    if (this.sendRule(ruleResult)) return { timestamp: this.sendTimestamp, body: this.alertBody(ruleResult), ruleResult };
  }
}
