import { ClickhouseService } from 'storage';
import { DataProcessingService } from './data-processing.service';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';
import { Owner, PrometheusService, PrometheusValStatus } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { ValidatorsStatusStats } from 'storage/clickhouse';
import { LidoSourceService } from 'common/validators-registry/lido-source';
import { RegistryOperator } from '@lido-nestjs/registry';

const GWEI_WEI_RATIO = 1e9;

@Injectable()
export class StatsProcessingService implements OnModuleInit {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,

    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly dataProcessor: DataProcessingService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.prometheus.slotTime = await this.dataProcessor.getSlotTime(this.dataProcessor.latestSlotInDb);
    this.prometheus.slotNumber.set(Number(this.dataProcessor.latestSlotInDb));
  }

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
    const syncParticipationAvgPercents = await this.storage.getSyncParticipationAvgPercents(slot);
    this.prometheus.userSyncParticipationAvgPercent.set(syncParticipationAvgPercents.user ?? 0);
    this.prometheus.chainSyncParticipationAvgPercent.set(syncParticipationAvgPercents.chain ?? 0);

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
    const missAttestationsLastEpoch = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(slot, 1);
    const missAttestationsLastNEpoch = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
    );
    const highRewardMissAttestationsLastNEpoch =
      possibleHighRewardValidators.length > 0
        ? await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(
            slot,
            this.config.get('BAD_ATTESTATION_EPOCHS'),
            possibleHighRewardValidators,
          )
        : [];
    operators.forEach((operator) => {
      const missAttestationLast = missAttestationsLastEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountMissAttestation.set(
        { nos_name: operator.name },
        missAttestationLast ? missAttestationLast.miss_attestation_count : 0,
      );
      const missAttestationLastN = missAttestationsLastNEpoch.find((a) => a.nos_name == operator.name);
      this.prometheus.validatorsCountMissAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        missAttestationLastN ? missAttestationLastN.miss_attestation_count : 0,
      );
      const highRewardMissAttestationLastN = highRewardMissAttestationsLastNEpoch.find((p) => p.nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountMissAttestationLastNEpoch.set(
        { nos_name: operator.name, epoch_interval: this.config.get('BAD_ATTESTATION_EPOCHS') },
        highRewardMissAttestationLastN ? highRewardMissAttestationLastN.miss_attestation_count : 0,
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
  async calculateOtherStats(otherBalances: ValidatorsStatusStats): Promise<void> {
    this.logger.log(`Other ongoing validators [${otherBalances.active_ongoing}]`);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Ongoing }, otherBalances.active_ongoing);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Pending }, otherBalances.pending);
    this.prometheus.validators.set({ owner: Owner.OTHER, status: PrometheusValStatus.Slashed }, otherBalances.slashed);
  }

  public async finalizeAppIterate(slot: bigint): Promise<void> {
    this.prometheus.slotTime = await this.dataProcessor.getSlotTime(slot);
    this.prometheus.slotNumber.set(Number(slot));
  }
}
