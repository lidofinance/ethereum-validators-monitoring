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

export interface PreparedToSendAlerts {
  [moduleId: string]: PreparedToSendAlert;
}

export interface AlertRuleResult {
  [operator: string]: any;
}

export interface AlertRulesResult {
  [moduleId: string]: AlertRuleResult;
}

export abstract class Alert {
  public readonly alertname: string;
  protected sendTimestamp: {
    [moduleId: string]: number
  };
  protected readonly config: ConfigService;
  protected readonly storage: ClickhouseService;
  protected readonly operators: RegistrySourceOperator[];

  protected constructor(name: string, config: ConfigService, storage: ClickhouseService, operators: RegistrySourceOperator[]) {
    this.alertname = name;
    this.sendTimestamp = {};
    this.config = config;
    this.storage = storage;
    this.operators = operators;
  }

  abstract alertRules(bySlot: number): Promise<AlertRulesResult>;

  abstract sendRule(moduleId: string, ruleResult: AlertRuleResult): boolean;

  abstract alertBody(moduleId: string, ruleResult: AlertRuleResult): AlertRequestBody;

  async toSend(epoch: Epoch): Promise<PreparedToSendAlerts | {}> {
    const rulesResult = await this.alertRules(epoch);
    const moduleIds = Object.keys(rulesResult);
    const result = {};

    for (const moduleId of moduleIds) {
      if (this.sendRule(moduleId, rulesResult[moduleId])) {
        result[moduleId] = {
          timestamp: this.sendTimestamp[moduleId],
          body: this.alertBody(moduleId, rulesResult[moduleId]),
          ruleResult: rulesResult[moduleId],
        };
      }
    }

    return result;
  }
}
