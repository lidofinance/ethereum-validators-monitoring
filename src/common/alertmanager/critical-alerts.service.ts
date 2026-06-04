import { LOGGER_PROVIDER, LoggerService } from '@lido-nestjs/logger';
import { Inject, Injectable } from '@nestjs/common';
import { got } from 'got-cjs';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';
import { Epoch } from 'common/types/types';
import { ClickhouseService } from 'storage';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';

import { AlertRequestBody, PreparedToSendAlert } from './alerts/BasicAlert';
import { CriticalMissedAttestations, MissedAttestationsRuleResult } from './alerts/CriticalMissedAttestations';
import { CriticalMissedProposes, MissedProposalsRuleResult } from './alerts/CriticalMissedProposes';
import { CriticalNegativeDelta, NegativeBalanceDeltaRuleResult } from './alerts/CriticalNegativeDelta';
import { CriticalSlashing, SlashingRuleResult } from './alerts/CriticalSlashing';
import {
  NOsProposesStats,
  NOsValidatorsByConditionAttestationCount,
  NOsValidatorsNegDeltaCount,
  NOsValidatorsStatusStats,
} from '../../storage/clickhouse';

interface SentAlerts {
  [alertname: string]: PreparedToSendAlert<
    SlashingRuleResult | MissedProposalsRuleResult | MissedAttestationsRuleResult | NegativeBalanceDeltaRuleResult
  >;
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
      const moduleIndexes = this.registryService.getModuleIndexes();
      const [nosStats, missedAttValidatorsCount, proposes, negativeValidatorsCount, prevNosStats] = (await Promise.all([
        this.storage.getUserNodeOperatorsStats(epoch),
        this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(epoch),
        this.storage.getUserNodeOperatorsProposesStats(epoch), // ~12h range
        this.storage.getValidatorsCountWithNegativeDelta(epoch),
        this.storage.getUserNodeOperatorsStats(epoch - 1),
      ])) as [
        NOsValidatorsStatusStats[],
        NOsValidatorsByConditionAttestationCount[],
        NOsProposesStats[],
        NOsValidatorsNegDeltaCount[],
        NOsValidatorsStatusStats[],
      ];

      const alerts = [];
      for (const moduleIndex of moduleIndexes) {
        const nosStatsForModule = nosStats.filter((o) => +o.val_nos_module_id === moduleIndex);
        const operatorsForModule = this.operators.filter((o) => o.module === moduleIndex);

        alerts.push(
          ...[
            new CriticalMissedAttestations(this.config, operatorsForModule, moduleIndex, nosStatsForModule, missedAttValidatorsCount),
            new CriticalMissedProposes(this.config, operatorsForModule, moduleIndex, nosStatsForModule, proposes),
            new CriticalNegativeDelta(this.config, operatorsForModule, moduleIndex, nosStatsForModule, negativeValidatorsCount),
            new CriticalSlashing(this.config, operatorsForModule, moduleIndex, nosStatsForModule, prevNosStats),
          ],
        );
      }

      for (const alert of alerts) {
        const toSend = alert.toSend();
        if (toSend == null) continue;

        await this.fire(toSend.body).then(() => (sentAlerts[alert.alertname] = toSend));
        this.logger.log(`Sent ${alert.alertname} alert`);
      }
    } catch (e) {
      this.logger.error(`Error when trying to processing critical alerts`);
      this.logger.error(e as Error);
    }
  }

  private async fire(alert: AlertRequestBody) {
    got
      .post(`${this.baseUrl}/api/v2/alerts`, { json: [alert] })
      .then((r) => r.statusCode)
      .catch((error) => {
        this.logger.error(`Error when trying to send alert`);
        this.logger.error(error as Error);
      });
  }
}
