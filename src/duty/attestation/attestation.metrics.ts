import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/consensus-provider/types';
import { allSettled } from 'common/functions/allSettled';
import { PrometheusService, TrackTask, setOtherOperatorsMetric, setUserOperatorsMetric } from 'common/prometheus';
import { ClickhouseService } from 'storage/clickhouse';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';

enum BadAttReason {
  HighIncDelay = 'high_inclusion_delay',
  InvalidHead = 'invalid_head',
  InvalidTarget = 'invalid_target',
  InvalidSource = 'invalid_source',
}

@Injectable()
export class AttestationMetrics {
  protected readonly epochInterval;
  protected processedEpoch: number;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {
    this.epochInterval = this.config.get('BAD_ATTESTATION_EPOCHS');
  }

  @TrackTask('calc-attestation-metrics')
  public async calculate(epoch: Epoch, possibleHighRewardValidators: string[]) {
    this.logger.log('Calculating attestation metrics');
    this.processedEpoch = epoch;
    this.operators = await this.registryService.getOperators();
    await allSettled([
      this.perfectAttestationsLastEpoch(),
      this.missedAttestationsLastEpoch(),
      this.highIncDelayAttestationsLastEpoch(),
      this.invalidHeadAttestationsLastEpoch(),
      this.invalidTargetAttestationsLastEpoch(),
      this.invalidSourceAttestationsLastEpoch(),

      this.missAttestationsLastNEpoch(),
      this.highIncDelayAttestationsLastNEpoch(),
      this.invalidHeadAttestationsLastNEpoch(),
      this.invalidTargetAttestationsLastNEpoch(),
      this.invalidSourceAttestationsLastNEpoch(),
      // metrics for alerts
      this.incDelayGtTwoAttestationsLastNEpoch(),
      this.invalidAttestationPropertyGtOneLastNEpoch(),
      this.highRewardMissAttestationsLastNEpoch(possibleHighRewardValidators),
    ]);
  }

  private async perfectAttestationsLastEpoch() {
    const data = await this.storage.getValidatorCountWithPerfectAttestationsLastEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountPerfectAttestation, data, this.operators);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountPerfectAttestation, data);
  }

  private async missedAttestationsLastEpoch() {
    const data = await this.storage.getValidatorCountWithMissedAttestationsLastEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountMissAttestation, data, this.operators);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountMissAttestation, data);
  }

  private async highIncDelayAttestationsLastEpoch() {
    const data = await this.storage.getValidatorCountWithHighIncDelayAttestationsLastEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestation, data, this.operators, {
      reason: BadAttReason.HighIncDelay,
    });
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountInvalidAttestation, data, { reason: BadAttReason.HighIncDelay });
  }

  private async invalidHeadAttestationsLastEpoch() {
    const data = await this.storage.getValidatorCountWithInvalidHeadAttestationsLastEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestation, data, this.operators, {
      reason: BadAttReason.InvalidHead,
    });
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountInvalidAttestation, data, { reason: BadAttReason.InvalidHead });
  }

  private async invalidTargetAttestationsLastEpoch() {
    const data = await this.storage.getValidatorCountWithInvalidTargetAttestationsLastEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestation, data, this.operators, {
      reason: BadAttReason.InvalidTarget,
    });
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountInvalidAttestation, data, { reason: BadAttReason.InvalidTarget });
  }

  private async invalidSourceAttestationsLastEpoch() {
    const data = await this.storage.getValidatorCountWithInvalidSourceAttestationsLastEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestation, data, this.operators, {
      reason: BadAttReason.InvalidSource,
    });
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountInvalidAttestation, data, { reason: BadAttReason.InvalidSource });
  }

  private async missAttestationsLastNEpoch() {
    const data = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountMissAttestationLastNEpoch, data, this.operators, {
      epoch_interval: this.epochInterval,
    });
  }

  private async highIncDelayAttestationsLastNEpoch() {
    const data = await this.storage.getValidatorCountIncDelayGtOneAttestationsLastNEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestationLastNEpoch, data, this.operators, {
      reason: BadAttReason.HighIncDelay,
      epoch_interval: this.epochInterval,
    });
  }

  private async invalidHeadAttestationsLastNEpoch() {
    const data = await this.storage.getValidatorCountWithInvalidHeadAttestationsLastNEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestationLastNEpoch, data, this.operators, {
      reason: BadAttReason.InvalidHead,
      epoch_interval: this.epochInterval,
    });
  }

  private async invalidTargetAttestationsLastNEpoch() {
    const data = await this.storage.getValidatorCountWithInvalidTargetAttestationsLastNEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestationLastNEpoch, data, this.operators, {
      reason: BadAttReason.InvalidTarget,
      epoch_interval: this.epochInterval,
    });
  }

  private async invalidSourceAttestationsLastNEpoch() {
    const data = await this.storage.getValidatorCountWithInvalidSourceAttestationsLastNEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestationLastNEpoch, data, this.operators, {
      reason: BadAttReason.InvalidSource,
      epoch_interval: this.epochInterval,
    });
  }

  private async incDelayGtTwoAttestationsLastNEpoch() {
    const data = await this.storage.getValidatorCountIncDelayGtTwoAttestationsLastNEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountHighIncDelayAttestationLastNEpoch, data, this.operators, {
      epoch_interval: this.epochInterval,
    });
  }

  private async invalidAttestationPropertyGtOneLastNEpoch() {
    const data = await this.storage.getValidatorCountWithInvalidAttestationsPropertyGtOneLastNEpoch(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountInvalidAttestationPropertyLastNEpoch, data, this.operators, {
      epoch_interval: this.epochInterval,
    });
  }

  private async highRewardMissAttestationsLastNEpoch(possibleHighRewardValidators: string[]) {
    if (possibleHighRewardValidators.length > 0) {
      const data = await this.storage.getValidatorCountWithHighRewardMissedAttestationsLastNEpoch(
        this.processedEpoch,
        possibleHighRewardValidators,
      );
      setUserOperatorsMetric(this.prometheus.highRewardValidatorsCountMissAttestationLastNEpoch, data, this.operators, {
        epoch_interval: this.epochInterval,
      });
    }
  }
}
