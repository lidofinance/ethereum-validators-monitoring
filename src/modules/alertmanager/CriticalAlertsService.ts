import { inject, injectable }                    from 'inversify';
import { ILogger }                               from '../logger/ILogger';
import { Environment }                           from '../environment/Environment';
import got                                       from 'got';
import { AlertRequestBody, PreparedToSendAlert } from './alerts/BasicAlert';
import { CriticalNegativeDelta }                 from './alerts/CriticalNegativeDelta';
import { CriticalMissedProposes }                from './alerts/CriticalMissedProposes';
import { CriticalMissedAttestations }            from './alerts/CriticalMissedAttestations';
import { ClickhouseStorage }                     from '../storage/ClickhouseStorage';

type SentAlerts = { [alertname: string]: PreparedToSendAlert };

export const sentAlerts: SentAlerts = {};

@injectable()
export class CriticalAlertsService {

  private readonly baseUrl;

  public constructor(
    @inject(ILogger) protected logger: ILogger,
    @inject(Environment) protected env: Environment,
    @inject(ClickhouseStorage) protected storage: ClickhouseStorage,
  ) {
    this.baseUrl = this.env.ALERTMANAGER_URL ?? '';
  }

  private get alerts() {
    return [
      new CriticalNegativeDelta(this.env, this.storage),
      new CriticalMissedProposes(this.env, this.storage),
      new CriticalMissedAttestations(this.env, this.storage)
    ]
  }

  public async sendCriticalAlerts(bySlot: bigint) {
    if (!this.baseUrl) {
      this.logger.warn(`Env var 'ALERTMANAGER_URL' is not set. Unable to send critical alerts`)
      return;
    }
    this.logger.info('Send critical alerts if exist')
    try {
      for (const alert of this.alerts) {
        const toSend = await alert.toSend(bySlot);
        if (toSend) await this.fire(toSend.body).then(() => sentAlerts[alert.alertname] = toSend);
      }
    } catch (e) {
      this.logger.error(`Error when trying to processing critical alerts`);
      this.logger.error(e as Error);
    }
  }

  async fire(alert: AlertRequestBody) {
    got.post(`${this.baseUrl}/api/v1/alerts`, {json: [alert]})
      .then((r) => r.statusCode)
      .catch(
        (error) => {
          this.logger.error(`Error when trying to send alert`);
          this.logger.error(error as Error);
        }
      )
  }

}
