import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { ClickhouseService } from 'storage/clickhouse';

enum BadAttReason {
  HighIncDelay = 'high_inclusion_delay',
  InvalidHead = 'invalid_head',
  InvalidTarget = 'invalid_target',
  InvalidSource = 'invalid_source',
}

@Injectable()
export class AttestationMetrics {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  public async calculate(epoch: bigint, possibleHighRewardValidators: string[]) {
    const operators = await this.registryService.getOperators();
    const missedAttestationsLastEpoch = await this.storage.getValidatorCountWithMissedAttestationsLastEpoch(epoch);
    const highIncDelayAttestationsLastEpoch = await this.storage.getValidatorCountWithHighIncDelayAttestationsLastEpoch(epoch);
    const invalidHeadAttestationsLastEpoch = await this.storage.getValidatorCountWithInvalidHeadAttestationsLastEpoch(epoch);
    const invalidTargetAttestationsLastEpoch = await this.storage.getValidatorCountWithInvalidTargetAttestationsLastEpoch(epoch);
    const invalidSourceAttestationsLastEpoch = await this.storage.getValidatorCountWithInvalidSourceAttestationsLastEpoch(epoch);
    const epochInterval = this.config.get('BAD_ATTESTATION_EPOCHS');
    const missAttestationsLastNEpoch = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(epoch);
    const highIncDelayAttestationsLastNEpoch = await this.storage.getValidatorCountWithHighIncDelayAttestationsLastNEpoch(epoch);
    const invalidHeadAttestationsLastNEpoch = await this.storage.getValidatorCountWithInvalidHeadAttestationsLastNEpoch(epoch);
    const invalidTargetAttestationsLastNEpoch = await this.storage.getValidatorCountWithInvalidTargetAttestationsLastNEpoch(epoch);
    const invalidSourceAttestationsLastNEpoch = await this.storage.getValidatorCountWithInvalidSourceAttestationsLastNEpoch(epoch);
    const highAvgIncDelayAttestationsOfNEpoch = await this.storage.getValidatorCountHighAvgIncDelayAttestationOfNEpochQuery(epoch);
    const invalidAttestationPropertyLastNEpoch = await this.storage.getValidatorCountWithInvalidAttestationsPropertyLastNEpoch(epoch);
    const highRewardMissAttestationsLastNEpoch =
      possibleHighRewardValidators.length > 0
        ? await this.storage.getValidatorCountWithHighRewardMissedAttestationsLastNEpoch(epoch, possibleHighRewardValidators)
        : [];
    operators.forEach((operator) => {
      const missAttestationLast = missedAttestationsLastEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountMissAttestation.set({ nos_name: operator.name }, missAttestationLast ? missAttestationLast.amount : 0);
      const highIncDelayAttestationLast = highIncDelayAttestationsLastEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.HighIncDelay },
        highIncDelayAttestationLast ? highIncDelayAttestationLast.amount : 0,
      );
      const invalidHeadAttestationLast = invalidHeadAttestationsLastEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidHead },
        invalidHeadAttestationLast ? invalidHeadAttestationLast.amount : 0,
      );
      const invalidTargetAttestationLast = invalidTargetAttestationsLastEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidTarget },
        invalidTargetAttestationLast ? invalidTargetAttestationLast.amount : 0,
      );
      const invalidSourceAttestationLast = invalidSourceAttestationsLastEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidSource },
        invalidSourceAttestationLast ? invalidSourceAttestationLast.amount : 0,
      );
      const missAttestationLastN = missAttestationsLastNEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountMissAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: epochInterval },
        missAttestationLastN ? missAttestationLastN.amount : 0,
      );
      const highIncDelayAttestationLastN = highIncDelayAttestationsLastNEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.HighIncDelay, epoch_interval: epochInterval },
        highIncDelayAttestationLastN ? highIncDelayAttestationLastN.amount : 0,
      );
      const invalidHeadAttestationLastN = invalidHeadAttestationsLastNEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidHead, epoch_interval: epochInterval },
        invalidHeadAttestationLastN ? invalidHeadAttestationLastN.amount : 0,
      );
      const invalidTargetAttestationLastN = invalidTargetAttestationsLastNEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidTarget, epoch_interval: epochInterval },
        invalidTargetAttestationLastN ? invalidTargetAttestationLastN.amount : 0,
      );
      const invalidSourceAttestationLastN = invalidSourceAttestationsLastNEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidSource, epoch_interval: epochInterval },
        invalidSourceAttestationLastN ? invalidSourceAttestationLastN.amount : 0,
      );
      const highAvgIncDelayAttestationsOfN = highAvgIncDelayAttestationsOfNEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountHighAvgIncDelayAttestationOfNEpoch.set(
        { nos_name: operator.name, epoch_interval: epochInterval },
        highAvgIncDelayAttestationsOfN ? highAvgIncDelayAttestationsOfN.amount : 0,
      );
      const invalidAttestationPropertyLastN = invalidAttestationPropertyLastNEpoch.find((a) => a.val_nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationPropertyOfNEpoch.set(
        { nos_name: operator.name, epoch_interval: epochInterval },
        invalidAttestationPropertyLastN ? invalidAttestationPropertyLastN.amount : 0,
      );
      const highRewardMissAttestationLastN = highRewardMissAttestationsLastNEpoch.find((p) => p.val_nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountMissAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: epochInterval },
        highRewardMissAttestationLastN ? highRewardMissAttestationLastN.amount : 0,
      );
    });
  }
}
