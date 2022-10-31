import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { RegistryOperator } from '@lido-nestjs/registry';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Owner, PrometheusService, PrometheusValStatus } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { LidoSourceService } from 'common/validators-registry/lido-source';
import { ClickhouseService } from 'storage';

import { DataProcessingService } from './data-processing.service';

const GWEI_WEI_RATIO = 1e9;

enum BadAttReason {
  HighIncDelay = 'high_inclusion_delay',
  InvalidHead = 'invalid_head',
  InvalidTarget = 'invalid_target',
  InvalidSource = 'invalid_source',
}

@Injectable()
export class StatsProcessingService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,

    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly dataProcessor: DataProcessingService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  /**
   * Calc stats by storage (validators info, att and prop duties) and push them to Prometheus
   */
  async calculateUserStats(epoch: bigint, possibleHighRewardValidators: string[]): Promise<void> {
    const operators = await this.registryService.getOperators();

    const nosStats = await this.storage.getUserNodeOperatorsStats(epoch);
    for (const nosStat of nosStats) {
      this.prometheus.userValidators.set({ nos_name: nosStat.val_nos_name, status: PrometheusValStatus.Slashed }, nosStat.slashed);
      this.prometheus.userValidators.set({ nos_name: nosStat.val_nos_name, status: PrometheusValStatus.Ongoing }, nosStat.active_ongoing);
      this.prometheus.userValidators.set({ nos_name: nosStat.val_nos_name, status: PrometheusValStatus.Pending }, nosStat.pending);
    }

    const userValidatorsStats = await this.storage.getUserValidatorsSummaryStats(epoch);
    this.logger.log(`User ongoing validators [${userValidatorsStats.active_ongoing}]`);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Slashed }, userValidatorsStats.slashed);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Ongoing }, userValidatorsStats.active_ongoing);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Pending }, userValidatorsStats.pending);

    const deltas = await this.storage.getValidatorBalancesDelta(epoch);
    for (const delta of deltas) {
      this.prometheus.validatorBalanceDelta.set({ nos_name: delta.val_nos_name }, delta.delta);
    }

    const minDeltas = await this.storage.getValidatorQuantile0001BalanceDeltas(epoch);
    for (const minDelta of minDeltas) {
      this.prometheus.validatorQuantile001BalanceDelta.set({ nos_name: minDelta.val_nos_name }, minDelta.delta);
    }

    const negativeValidatorsCount = await this.storage.getValidatorsCountWithNegativeDelta(epoch);
    operators.forEach((operator) => {
      const negDelta = negativeValidatorsCount.find((d) => d.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithNegativeBalanceDelta.set({ nos_name: operator.name }, negDelta ? negDelta.neg_count : 0);
    });

    // Validator Sync Committee participation
    const userSyncParticipationAvgPercent = await this.storage.getUserSyncParticipationAvgPercent(epoch);
    this.prometheus.userSyncParticipationAvgPercent.set(userSyncParticipationAvgPercent.avg_percent ?? 0);

    const operatorSyncParticipationAvgPercents = await this.storage.getOperatorSyncParticipationAvgPercents(epoch);
    operatorSyncParticipationAvgPercents.forEach((p) => {
      this.prometheus.operatorSyncParticipationAvgPercent.set({ nos_name: p.val_nos_name }, p.avg_percent);
    });

    const chainAvgSyncPercent = await this.storage.getChainSyncParticipationAvgPercent(epoch);
    this.prometheus.chainSyncParticipationAvgPercent.set(chainAvgSyncPercent.avg_percent);

    const syncParticipationLastEpoch = await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
      epoch,
      1,
      chainAvgSyncPercent.avg_percent,
    );
    const syncParticipationLastNEpoch = await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
      epoch,
      this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
      chainAvgSyncPercent.avg_percent,
    );
    const highRewardSyncParticipationLastNEpoch =
      possibleHighRewardValidators.length > 0
        ? await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
            epoch,
            this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
            chainAvgSyncPercent.avg_percent,
            possibleHighRewardValidators,
          )
        : [];
    operators.forEach((operator) => {
      const last = syncParticipationLastEpoch.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvg.set({ nos_name: operator.name }, last ? last.less_chain_avg_count : 0);
      const lastN = syncParticipationLastNEpoch.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        {
          nos_name: operator.name,
          epoch_interval: this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
        },
        lastN ? lastN.less_chain_avg_count : 0,
      );
      const highRewardLastN = highRewardSyncParticipationLastNEpoch.find((p) => p.val_nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        {
          nos_name: operator.name,
          epoch_interval: this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
        },
        highRewardLastN ? highRewardLastN.less_chain_avg_count : 0,
      );
    });

    // Validator Block Attestation
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

    // Validator Block Propose
    const missProposes = await this.storage.getValidatorsCountWithMissedProposes(epoch);
    const highRewardMissProposes =
      possibleHighRewardValidators.length > 0
        ? await this.storage.getValidatorsCountWithMissedProposes(epoch, possibleHighRewardValidators)
        : [];
    operators.forEach((operator) => {
      const missPropose = missProposes.find((p) => p.val_nos_name == operator.name);
      this.prometheus.validatorsCountMissPropose.set({ nos_name: operator.name }, missPropose ? missPropose.miss_propose_count : 0);
      const highRewardMissPropose = highRewardMissProposes.find((p) => p.val_nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountMissPropose.set(
        { nos_name: operator.name },
        highRewardMissPropose ? highRewardMissPropose.miss_propose_count : 0,
      );
    });

    const totalBalance24hDifference = await this.storage.getTotalBalance24hDifference(epoch);
    if (totalBalance24hDifference != undefined) {
      this.prometheus.totalBalance24hDifference.set(totalBalance24hDifference);
    }
    const operatorBalance24hDifference = await this.storage.getOperatorBalance24hDifference(epoch);
    operatorBalance24hDifference.forEach((d) => {
      this.prometheus.operatorBalance24hDifference.set({ nos_name: d.nos_name }, d.diff);
    });

    if (this.registryService.source instanceof LidoSourceService) {
      this.prometheus.contractKeysTotal.set(
        { type: 'total' },
        operators.reduce((sum, o: RegistryOperator) => sum + o.totalSigningKeys, 0),
      );
      this.prometheus.contractKeysTotal.set(
        { type: 'used' },
        operators.reduce((sum, o: RegistryOperator) => sum + o.usedSigningKeys, 0),
      );
      // only for operators with 0 used keys
      operators.forEach((operator: RegistryOperator) => {
        if (operator.usedSigningKeys == 0) {
          this.prometheus.userValidators.set({ nos_name: operator.name, status: PrometheusValStatus.Ongoing }, 0);
        }
      });

      const bufferedEther = (await this.registryService.source.contract.getBufferedEther()).div(GWEI_WEI_RATIO).div(GWEI_WEI_RATIO);
      this.prometheus.bufferedEther.set(bufferedEther.toNumber());
    }
  }

  /**
   * Calc stats by in-memory other validators data (ongoing, pending, slashed validators)
   */
  async calculateOtherStats(epoch: bigint): Promise<void> {
    const otherValidatorsStats = await this.storage.getOtherValidatorsSummaryStats(epoch);
    this.logger.log(`Other ongoing validators [${otherValidatorsStats.active_ongoing}]`);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Ongoing }, otherValidatorsStats.active_ongoing);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Pending }, otherValidatorsStats.pending);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Slashed }, otherValidatorsStats.slashed);

    // Other Sync Committee participation
    const otherAvgSyncPercent = await this.storage.getOtherSyncParticipationAvgPercent(epoch);
    this.prometheus.otherSyncParticipationAvgPercent.set(otherAvgSyncPercent.avg_percent);
  }

  public async finalizeAppIterate(epoch: bigint): Promise<void> {
    this.prometheus.epochTime = await this.dataProcessor.getSlotTime(epoch * 32n);
    this.prometheus.epochNumber.set(Number(epoch));
  }
}
