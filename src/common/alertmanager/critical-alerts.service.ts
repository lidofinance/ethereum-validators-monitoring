import { LOGGER_PROVIDER, LoggerService } from '@lido-nestjs/logger';
import { Inject, Injectable } from '@nestjs/common';
import { got } from 'got-cjs';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { PrometheusService } from 'common/prometheus';
import { ClickhouseService } from 'storage';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';

import { AlertRequestBody, PreparedToSendAlert } from './alerts/BasicAlert';
import { CriticalMissedAttestations } from './alerts/CriticalMissedAttestations';
import { CriticalMissedProposes } from './alerts/CriticalMissedProposes';
import { CriticalNegativeDelta } from './alerts/CriticalNegativeDelta';
import { CriticalSlashing } from './alerts/CriticalSlashing';

interface SentAlerts {
  [alertname: string]: {
    [moduleId: string]: PreparedToSendAlert
  };
}

export const sentAlerts: SentAlerts = {};

@Injectable()
export class CriticalAlertsService {
  private readonly baseUrl;
  protected operators: RegistrySourceOperator[];

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly storage: ClickhouseService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
  ) {
    this.baseUrl = this.config.get('CRITICAL_ALERTS_ALERTMANAGER_URL') ?? '';
  }

  public async send(epoch: Epoch) {
    this.operators = await this.registryService.getOperators();
    if (this.prometheus.getSlotTimeDiffWithNow() > 3600000) {
      this.logger.warn(`Data actuality greater than 1 hour. Critical alerts are suppressed`);
      return;
    }
    if (!this.baseUrl) {
      this.logger.warn(`Env var 'CRITICAL_ALERTS_ALERTMANAGER_URL' is not set. Unable to send critical alerts`);
      return;
    }
    try {
      for (const alert of this.alerts) {
        const toSend = await alert.toSend(epoch);
        const moduleIds = Object.keys(toSend);
        if (moduleIds.length === 0) continue;

        for (const moduleId of moduleIds) {
          await this.fire(toSend[moduleId].body).then(() => {
            if (sentAlerts[alert.alertname] == null) {
              sentAlerts[alert.alertname] = {};
            }

            sentAlerts[alert.alertname][moduleId] = toSend[moduleId];
          });
        }

        this.logger.log(`Sent ${alert.alertname} alert for modules [${moduleIds.join(', ')}]`);
      }
    } catch (e) {
      this.logger.error(`Error when trying to processing critical alerts`);
      this.logger.error(e as Error);
    }
  }

  private get alerts() {
    return [
      new CriticalNegativeDelta(this.config, this.storage, this.operators),
      new CriticalMissedProposes(this.config, this.storage, this.operators),
      new CriticalMissedAttestations(this.config, this.storage, this.operators),
      new CriticalSlashing(this.config, this.storage, this.operators),
    ];
  }

  private async fire(alert: AlertRequestBody) {
    got
      .post(`${this.baseUrl}/api/v1/alerts`, { json: [alert] })
      .then((r) => r.statusCode)
      .catch((error) => {
        this.logger.error(`Error when trying to send alert`);
        this.logger.error(error as Error);
      });
  }
}
