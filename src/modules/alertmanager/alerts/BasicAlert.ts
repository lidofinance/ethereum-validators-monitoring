import { Environment }       from '../../environment/Environment';
import { ClickhouseStorage } from '../../storage/ClickhouseStorage';

export type AlertRequestBody = { startsAt: string, endsAt: string, labels: any, annotations: any }

export type PreparedToSendAlert = { timestamp: number, body: AlertRequestBody, ruleResult: AlertRuleResult }

export type AlertRuleResult = { [operator: string]: any };

export abstract class Alert {
  public readonly alertname: string = '';
  protected sendTimestamp: number = 0;
  protected readonly env: Environment;
  protected readonly storage: ClickhouseStorage;

  protected constructor(name: string, env: Environment, storage: ClickhouseStorage) {
    this.alertname = name;
    this.env = env;
    this.storage = storage;
  }

  abstract alertRule(bySlot: bigint): Promise<AlertRuleResult>

  abstract sendRule(ruleResult: AlertRuleResult): boolean

  abstract alertBody(ruleResult: AlertRuleResult): AlertRequestBody

  async toSend(bySlot: bigint): Promise<PreparedToSendAlert | undefined> {
    const ruleResult = await this.alertRule(bySlot);
    if (this.sendRule(ruleResult)) return {timestamp: this.sendTimestamp, body: this.alertBody(ruleResult), ruleResult};
  }
}

