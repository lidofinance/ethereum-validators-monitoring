import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { RegistryService, RegistrySourceOperator } from 'common/validators-registry';
import { ClickhouseService } from 'storage/clickhouse';

enum BadAttReason {
  HighIncDelay = 'high_inclusion_delay',
  InvalidHead = 'invalid_head',
  InvalidTarget = 'invalid_target',
  InvalidSource = 'invalid_source',
}

@Injectable()
export class AttestationMetrics {
  protected readonly epochInterval;
  protected processedEpoch: bigint;
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
  public async calculate(epoch: bigint, possibleHighRewardValidators: string[]) {
    this.logger.log('Calculating attestation metrics');
    this.processedEpoch = epoch;
    this.operators = await this.registryService.getOperators();
    await Promise.all([
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
      this.highAvgIncDelayAttestationsOfNEpoch(),
      // metrics for alerts
      this.incDelayGtTwoAttestationsLastNEpoch(),
      this.invalidAttestationPropertyGtOneLastNEpoch(),
      this.highRewardMissAttestationsLastNEpoch(possibleHighRewardValidators),
    ]);
  }

  private async perfectAttestationsLastEpoch() {
    const result = await this.storage.getValidatorCountWithPerfectAttestationsLastEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountPerfectAttestation.set({ nos_name: operator.name }, operatorResult ? operatorResult.amount : 0);
    });
    const other = result.find((a) => a.val_nos_id == null);
    this.prometheus.otherValidatorsCountPerfectAttestation.set(other ? other.amount : 0);
  }

  private async missedAttestationsLastEpoch() {
    const result = await this.storage.getValidatorCountWithMissedAttestationsLastEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountMissAttestation.set({ nos_name: operator.name }, operatorResult ? operatorResult.amount : 0);
    });
    const other = result.find((a) => a.val_nos_id == null);
    this.prometheus.otherValidatorsCountMissAttestation.set(other ? other.amount : 0);
  }

  private async highIncDelayAttestationsLastEpoch() {
    const result = await this.storage.getValidatorCountWithHighIncDelayAttestationsLastEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.HighIncDelay },
        operatorResult ? operatorResult.amount : 0,
      );
    });
    const other = result.find((a) => a.val_nos_id == null);
    this.prometheus.otherValidatorsCountInvalidAttestation.set({ reason: BadAttReason.HighIncDelay }, other ? other.amount : 0);
  }

  private async invalidHeadAttestationsLastEpoch() {
    const result = await this.storage.getValidatorCountWithInvalidHeadAttestationsLastEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidHead },
        operatorResult ? operatorResult.amount : 0,
      );
    });
    const other = result.find((a) => a.val_nos_id == null);
    this.prometheus.otherValidatorsCountInvalidAttestation.set({ reason: BadAttReason.InvalidHead }, other ? other.amount : 0);
  }

  private async invalidTargetAttestationsLastEpoch() {
    const result = await this.storage.getValidatorCountWithInvalidTargetAttestationsLastEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidTarget },
        operatorResult ? operatorResult.amount : 0,
      );
    });
    const other = result.find((a) => a.val_nos_id == null);
    this.prometheus.otherValidatorsCountInvalidAttestation.set({ reason: BadAttReason.InvalidTarget }, other ? other.amount : 0);
  }

  private async invalidSourceAttestationsLastEpoch() {
    const result = await this.storage.getValidatorCountWithInvalidSourceAttestationsLastEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidSource },
        operatorResult ? operatorResult.amount : 0,
      );
    });
    const other = result.find((a) => a.val_nos_id == null);
    this.prometheus.otherValidatorsCountInvalidAttestation.set({ reason: BadAttReason.InvalidSource }, other ? other.amount : 0);
  }

  private async missAttestationsLastNEpoch() {
    const result = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountMissAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async highIncDelayAttestationsLastNEpoch() {
    const result = await this.storage.getValidatorCountIncDelayGtOneAttestationsLastNEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.HighIncDelay, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async invalidHeadAttestationsLastNEpoch() {
    const result = await this.storage.getValidatorCountWithInvalidHeadAttestationsLastNEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidHead, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async invalidTargetAttestationsLastNEpoch() {
    const result = await this.storage.getValidatorCountWithInvalidTargetAttestationsLastNEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidTarget, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async invalidSourceAttestationsLastNEpoch() {
    const result = await this.storage.getValidatorCountWithInvalidSourceAttestationsLastNEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidSource, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async highAvgIncDelayAttestationsOfNEpoch() {
    const result = await this.storage.getValidatorCountHighAvgIncDelayAttestationOfNEpochQuery(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountHighAvgIncDelayAttestationOfNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async incDelayGtTwoAttestationsLastNEpoch() {
    const result = await this.storage.getValidatorCountIncDelayGtTwoAttestationsLastNEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountHighIncDelayAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async invalidAttestationPropertyGtOneLastNEpoch() {
    const result = await this.storage.getValidatorCountWithInvalidAttestationsPropertyGtOneLastNEpoch(this.processedEpoch);
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id != null && +a.val_nos_id == operator.index);
      this.prometheus.validatorsCountInvalidAttestationPropertyLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }

  private async highRewardMissAttestationsLastNEpoch(possibleHighRewardValidators: string[]) {
    let result = [];
    if (possibleHighRewardValidators.length > 0)
      result = await this.storage.getValidatorCountWithHighRewardMissedAttestationsLastNEpoch(
        this.processedEpoch,
        possibleHighRewardValidators,
      );
    this.operators.forEach((operator) => {
      const operatorResult = result.find((a) => a.val_nos_id == operator.index);
      this.prometheus.highRewardValidatorsCountMissAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.epochInterval },
        operatorResult ? operatorResult.amount : 0,
      );
    });
  }
}
