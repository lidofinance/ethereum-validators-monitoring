import { ClickhouseService } from 'storage';
import { DataProcessingService } from './data-processing.service';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';
import { Owner, PrometheusService, PrometheusValStatus } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { ValidatorsStatusStats } from 'storage/clickhouse';
import { LidoSourceService } from 'common/validators-registry/lido-source';
import { RegistryOperator } from '@lido-nestjs/registry';

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
  async calculateUserStats(slot: bigint, possibleHighRewardValidators: string[]): Promise<void> {
    const operators = await this.registryService.getOperators();

    const nosStats = await this.storage.getUserNodeOperatorsStats(slot);
    for (const nosStat of nosStats) {
      this.prometheus.userValidators.set({ nos_name: nosStat.nos_name, status: PrometheusValStatus.Slashed }, nosStat.slashed);
      this.prometheus.userValidators.set({ nos_name: nosStat.nos_name, status: PrometheusValStatus.Ongoing }, nosStat.active_ongoing);
      this.prometheus.userValidators.set({ nos_name: nosStat.nos_name, status: PrometheusValStatus.Pending }, nosStat.pending);
    }

    const userValidatorsStats = await this.storage.getUserValidatorsSummaryStats(slot);
    this.logger.log(`User ongoing validators [${userValidatorsStats.active_ongoing}]`);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Slashed }, userValidatorsStats.slashed);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Ongoing }, userValidatorsStats.active_ongoing);
    this.prometheus.validators.set({ owner: Owner.USER, status: PrometheusValStatus.Pending }, userValidatorsStats.pending);

    const deltas = await this.storage.getValidatorBalancesDelta(slot);
    for (const delta of deltas) {
      this.prometheus.validatorBalanceDelta.set({ nos_name: delta.nos_name }, delta.delta);
    }

    const minDeltas = await this.storage.getValidatorQuantile0001BalanceDeltas(slot);
    for (const minDelta of minDeltas) {
      this.prometheus.validatorQuantile001BalanceDelta.set({ nos_name: minDelta.nos_name }, minDelta.delta);
    }

    const negativeValidatorsCount = await this.storage.getValidatorsCountWithNegativeDelta(slot);
    operators.forEach((operator) => {
      const negDelta = negativeValidatorsCount.find((d) => d.nos_name == operator.name);
      this.prometheus.validatorsCountWithNegativeBalanceDelta.set({ nos_name: operator.name }, negDelta ? negDelta.neg_count : 0);
    });

    // Validator Sync Committee participation
    const userSyncParticipationAvgPercent = await this.storage.getUserSyncParticipationAvgPercent(slot);
    this.prometheus.userSyncParticipationAvgPercent.set(userSyncParticipationAvgPercent.avg_percent ?? 0);

    const operatorSyncParticipationAvgPercents = await this.storage.getOperatorSyncParticipationAvgPercents(slot);
    operatorSyncParticipationAvgPercents.forEach((p) => {
      this.prometheus.operatorSyncParticipationAvgPercent.set({ nos_name: p.nos_name }, p.avg_percent);
    });

    const syncParticipationLastEpoch = await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(slot, 1);
    const syncParticipationLastNEpoch = await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
      slot,
      this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
    );
    const highRewardSyncParticipationLastNEpoch =
      possibleHighRewardValidators.length > 0
        ? await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
            slot,
            this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
            possibleHighRewardValidators,
          )
        : [];
    operators.forEach((operator) => {
      const last = syncParticipationLastEpoch.find((p) => p.nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvg.set({ nos_name: operator.name }, last ? last.less_chain_avg_count : 0);
      const lastN = syncParticipationLastNEpoch.find((p) => p.nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        {
          nos_name: operator.name,
          epoch_interval: this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
        },
        lastN ? lastN.less_chain_avg_count : 0,
      );
      const highRewardLastN = highRewardSyncParticipationLastNEpoch.find((p) => p.nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        {
          nos_name: operator.name,
          epoch_interval: this.config.get('SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG'),
        },
        highRewardLastN ? highRewardLastN.less_chain_avg_count : 0,
      );
    });

    // Validator Block Attestation
    const missAttestationsLastEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(slot, 1, 'attested = 0');
    const highIncDelayAttestationsLastEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      1,
      'inclusion_delay > 1',
    );
    const invalidHeadAttestationsLastEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      1,
      'valid_head = 0',
    );
    const invalidTargetAttestationsLastEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      1,
      'valid_target = 0',
    );
    const invalidSourceAttestationsLastEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      1,
      'valid_source = 0',
    );
    const missAttestationsLastNEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'attested = 0',
    );
    const highIncDelayAttestationsLastNEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'inclusion_delay > 1',
    );
    const invalidHeadAttestationsLastNEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'valid_head = 0',
    );
    const invalidTargetAttestationsLastNEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'valid_target = 0',
    );
    const invalidSourceAttestationsLastNEpoch = await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'valid_source = 0',
    );
    const highAvgIncDelayAttestationsOfNEpoch = await this.storage.getValidatorCountHighAvgIncDelayAttestationOfNEpochQuery(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
    );
    const highRewardMissAttestationsLastNEpoch =
      possibleHighRewardValidators.length > 0
        ? await this.storage.getValidatorCountByConditionAttestationsLastNEpoch(
            slot,
            this.config.get('BAD_ATTESTATION_EPOCHS'),
            'attested = 0',
            possibleHighRewardValidators,
          )
        : [];
    operators.forEach((operator) => {
      const missAttestationLast = missAttestationsLastEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountMissAttestation.set(
        { nos_name: operator.name },
        missAttestationLast ? missAttestationLast.suitable : 0,
      );
      const highIncDelayAttestationLast = highIncDelayAttestationsLastEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.HighIncDelay },
        highIncDelayAttestationLast ? highIncDelayAttestationLast.suitable : 0,
      );
      const invalidHeadAttestationLast = invalidHeadAttestationsLastEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidHead },
        invalidHeadAttestationLast ? invalidHeadAttestationLast.suitable : 0,
      );
      const invalidTargetAttestationLast = invalidTargetAttestationsLastEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidTarget },
        invalidTargetAttestationLast ? invalidTargetAttestationLast.suitable : 0,
      );
      const invalidSourceAttestationLast = invalidSourceAttestationsLastEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestation.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidSource },
        invalidSourceAttestationLast ? invalidSourceAttestationLast.suitable : 0,
      );
      const missAttestationLastN = missAttestationsLastNEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountMissAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        missAttestationLastN ? missAttestationLastN.suitable : 0,
      );
      const highIncDelayAttestationLastN = highIncDelayAttestationsLastNEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.HighIncDelay, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        highIncDelayAttestationLastN ? highIncDelayAttestationLastN.suitable : 0,
      );
      const invalidHeadAttestationLastN = invalidHeadAttestationsLastNEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidHead, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        invalidHeadAttestationLastN ? invalidHeadAttestationLastN.suitable : 0,
      );
      const invalidTargetAttestationLastN = invalidTargetAttestationsLastNEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidTarget, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        invalidTargetAttestationLastN ? invalidTargetAttestationLastN.suitable : 0,
      );
      const invalidSourceAttestationLastN = invalidSourceAttestationsLastNEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountInvalidAttestationLastNEpoch.set(
        { nos_name: operator.name, reason: BadAttReason.InvalidSource, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        invalidSourceAttestationLastN ? invalidSourceAttestationLastN.suitable : 0,
      );
      const highAvgIncDelayAttestationsOfN = highAvgIncDelayAttestationsOfNEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountHighAvgIncDelayAttestationOfNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        highAvgIncDelayAttestationsOfN ? highAvgIncDelayAttestationsOfN.suitable : 0,
      );
      const highRewardMissAttestationLastN = highRewardMissAttestationsLastNEpoch.find((p) => p.nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountMissAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        highRewardMissAttestationLastN ? highRewardMissAttestationLastN.suitable : 0,
      );
    });

    // Validator Block Propose
    const missProposes = await this.storage.getValidatorsCountWithMissedProposes(slot);
    const highRewardMissProposes =
      possibleHighRewardValidators.length > 0
        ? await this.storage.getValidatorsCountWithMissedProposes(slot, possibleHighRewardValidators)
        : [];
    operators.forEach((operator) => {
      const missPropose = missProposes.find((p) => p.nos_name == operator.name);
      this.prometheus.validatorsCountMissPropose.set({ nos_name: operator.name }, missPropose ? missPropose.miss_propose_count : 0);
      const highRewardMissPropose = highRewardMissProposes.find((p) => p.nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountMissPropose.set(
        { nos_name: operator.name },
        highRewardMissPropose ? highRewardMissPropose.miss_propose_count : 0,
      );
    });

    const totalBalance24hDifference = await this.storage.getTotalBalance24hDifference(slot);
    if (totalBalance24hDifference != undefined) {
      this.prometheus.totalBalance24hDifference.set(totalBalance24hDifference);
    }
    const operatorBalance24hDifference = await this.storage.getOperatorBalance24hDifference(slot);
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
  async calculateOtherStats(otherValidatorsCounts: ValidatorsStatusStats, otherAvgSyncPercent: number): Promise<void> {
    this.logger.log(`Other ongoing validators [${otherValidatorsCounts.active_ongoing}]`);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Ongoing }, otherValidatorsCounts.active_ongoing);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Pending }, otherValidatorsCounts.pending);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Slashed }, otherValidatorsCounts.slashed);

    // Other Sync Committee participation
    if (otherAvgSyncPercent != undefined) this.prometheus.chainSyncParticipationAvgPercent.set(otherAvgSyncPercent);
  }

  public async finalizeAppIterate(slot: bigint): Promise<void> {
    this.prometheus.slotTime = await this.dataProcessor.getSlotTime(slot);
    this.prometheus.slotNumber.set(Number(slot));
  }
}
