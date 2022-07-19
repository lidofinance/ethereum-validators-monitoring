import { inject, injectable, postConstruct } from 'inversify';
import { ILogger }                           from '../logger/ILogger';
import { NodeOperatorsContract }             from '../eth-rpc/NodeOperatorsContract';
import { StEthContract }                      from '../eth-rpc/StEthContract';
import { ClickhouseStorage, ValidatorCounts } from '../storage/ClickhouseStorage';
import { Prometheus }                         from '../prometheus/Prometheus';
import { DataProcessor }    from './DataProcessing';
import { PrometheusValStatus }               from '../lighthouse/types/ValidatorStatus';
import { Environment }                       from '../environment/Environment';

@injectable()
export class StatsProcessor {

  public constructor(
    @inject(ILogger) protected logger: ILogger,
    @inject(NodeOperatorsContract) protected nodeOperatorsContract: NodeOperatorsContract,
    @inject(StEthContract) protected stEthContract: StEthContract,
    @inject(ClickhouseStorage) protected storage: ClickhouseStorage,
    @inject(Prometheus) protected prometheus: Prometheus,
    @inject(DataProcessor) protected dataProcessor: DataProcessor,
    @inject(Environment) protected environment: Environment
  ) {
  }

  @postConstruct()
  public async initialize(): Promise<void> {
    this.prometheus.slotTime = await this.dataProcessor.getSlotTime(this.dataProcessor.latestSlotInDb);
    this.prometheus.slotNumber.set(Number(this.dataProcessor.latestSlotInDb));
  }

  /**
   * Calc stats by storage (validators info, att and prop duties) and push them to Prometheus
   */
  async calculateLidoStats(slot: bigint, possibleHighRewardValidators: string[]): Promise<void> {
    const operators = await this.nodeOperatorsContract.getOperators();
    this.prometheus.contractKeysTotal.set({ type: 'total' }, operators.reduce((sum, o) => sum + o.totalSigningKeys.toNumber(), 0));
    this.prometheus.contractKeysTotal.set({ type: 'used' }, operators.reduce((sum, o) => sum + o.usedSigningKeys.toNumber(), 0));

    // only for operators with 0 used keys
    operators.forEach(operator => {
      if (operator.usedSigningKeys.eq(0)) {
        this.prometheus.lidoValidators.set({ nos_name: operator.name, status: PrometheusValStatus.Ongoing }, 0);
      }
    });

    const nosStats = await this.storage.getLidoNodeOperatorsStats(slot);
    for (const nosStat of nosStats) {
      this.prometheus.lidoValidators.set({ nos_name: nosStat.nos_name, status: PrometheusValStatus.Slashed }, nosStat.slashed);
      this.prometheus.lidoValidators.set({ nos_name: nosStat.nos_name, status: PrometheusValStatus.Ongoing }, nosStat.active_ongoing);
      this.prometheus.lidoValidators.set({ nos_name: nosStat.nos_name, status: PrometheusValStatus.Pending }, nosStat.pending);
    }

    const lidoValidatorsStats = await this.storage.getLidoValidatorsSummaryStats(slot);
    this.logger.info('Lido ongoing validators [%d]', lidoValidatorsStats.active_ongoing);
    this.prometheus.validators.set({ owner: 'lido', status: PrometheusValStatus.Slashed }, lidoValidatorsStats.slashed);
    this.prometheus.validators.set({ owner: 'lido', status: PrometheusValStatus.Ongoing }, lidoValidatorsStats.active_ongoing);
    this.prometheus.validators.set({ owner: 'lido', status: PrometheusValStatus.Pending }, lidoValidatorsStats.pending);

    const deltas = await this.storage.getValidatorBalancesDelta(slot);
    for (const delta of deltas) {
      this.prometheus.validatorBalanceDelta.set({ nos_name: delta.nos_name }, delta.delta);
    }

    const minDeltas = await this.storage.getValidatorQuantile0001BalanceDeltas(slot);
    for (const minDelta of minDeltas) {
      this.prometheus.validatorQuantile001BalanceDelta.set({ nos_name: minDelta.nos_name }, minDelta.delta);
    }

    const negativeValidatorsCount = await this.storage.getValidatorsCountWithNegativeDelta(slot);
    operators.forEach(operator => {
      const negDelta = negativeValidatorsCount.find(d => d.nos_name == operator.name);
      this.prometheus.validatorsCountWithNegativeBalanceDelta.set({ nos_name: operator.name }, negDelta? negDelta.neg_count:0);
    });

    // Validator Sync Committee participation
    const syncParticipationAvgPercents = await this.storage.getSyncParticipationAvgPercents(slot);
    this.prometheus.lidoSyncParticipationAvgPercent.set(syncParticipationAvgPercents.lido ?? 0);
    this.prometheus.chainSyncParticipationAvgPercent.set(syncParticipationAvgPercents.chain ?? 0);

    const syncParticipationLastEpoch = await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
      slot, 1
    );
    const syncParticipationLastNEpoch = await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
      slot, this.environment.SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG
    );
    const highRewardSyncParticipationLastNEpoch = (possibleHighRewardValidators.length > 0) ? (
      await this.storage.getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
        slot,
        this.environment.SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG,
        possibleHighRewardValidators
      )
    ) : [];
    operators.forEach(operator => {
      const last = syncParticipationLastEpoch.find(p => p.nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvg.set(
        {nos_name: operator.name}, last? last.less_chain_avg_count:0
      );
      const lastN = syncParticipationLastNEpoch.find(p => p.nos_name == operator.name);
      this.prometheus.validatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        {
          nos_name: operator.name, epoch_interval: this.environment.SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG
        }, lastN? lastN.less_chain_avg_count:0
      );
      const highRewardLastN = highRewardSyncParticipationLastNEpoch.find(p => p.nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountWithSyncParticipationLessAvgLastNEpoch.set(
        {
          nos_name: operator.name, epoch_interval: this.environment.SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG
        }, highRewardLastN? highRewardLastN.less_chain_avg_count:0
      );
    });


    // Validator Block Attestation
    const missAttestationsLastEpoch = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(slot, 1);
    const missAttestationsLastNEpoch = await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(
      slot, this.environment.BAD_ATTESTATION_EPOCHS
    );
    const highRewardMissAttestationsLastNEpoch = (possibleHighRewardValidators.length > 0) ? (
      await this.storage.getValidatorCountWithMissedAttestationsLastNEpoch(
        slot, this.environment.BAD_ATTESTATION_EPOCHS, possibleHighRewardValidators
      )
    ) : [];
    operators.forEach(operator => {
      const missAttestationLast = missAttestationsLastEpoch.find(a => a.nos_name == operator.name);
      this.prometheus.validatorsCountMissAttestation.set(
        {nos_name: operator.name}, missAttestationLast? missAttestationLast.miss_attestation_count:0
      );
      const missAttestationLastN = missAttestationsLastNEpoch.find(a => a.nos_name == operator.name);
      this.prometheus.validatorsCountMissAttestationLastNEpoch.set(
        {nos_name: operator.name, epoch_interval: this.environment.BAD_ATTESTATION_EPOCHS},
        missAttestationLastN? missAttestationLastN.miss_attestation_count:0
      );
      const highRewardMissAttestationLastN = highRewardMissAttestationsLastNEpoch.find(p => p.nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountMissAttestationLastNEpoch.set(
        {nos_name: operator.name, epoch_interval: this.environment.BAD_ATTESTATION_EPOCHS},
        highRewardMissAttestationLastN? highRewardMissAttestationLastN.miss_attestation_count:0
      );
    });

    // Validator Block Propose
    const missProposes = await this.storage.getValidatorsCountWithMissedProposes(slot);
    const highRewardMissProposes = (possibleHighRewardValidators.length > 0) ? (
      await this.storage.getValidatorsCountWithMissedProposes(slot, possibleHighRewardValidators)
    ) : [];
    operators.forEach(operator => {
      const missPropose = missProposes.find(p => p.nos_name == operator.name);
      this.prometheus.validatorsCountMissPropose.set(
        {nos_name: operator.name}, missPropose? missPropose.miss_propose_count:0
      );
      const highRewardMissPropose = highRewardMissProposes.find(p => p.nos_name == operator.name);
      this.prometheus.highRewardValidatorsCountMissPropose.set(
        {nos_name: operator.name}, highRewardMissPropose? highRewardMissPropose.miss_propose_count:0
      );
    });

    const totalBalance24hDifference = await this.storage.getTotalBalance24hDifference(slot);
    if (totalBalance24hDifference != undefined) {
      this.prometheus.totalBalance24hDifference.set(totalBalance24hDifference);
    }

    const bufferedEther = (await this.stEthContract.getBufferedEther()).div(1e9).div(1e9);
    this.prometheus.bufferedEther.set(bufferedEther.toNumber());
  }

  /**
   * Calc stats by in-memory other validators data (ongoing, pending, slashed validators)
   */
  async calculateOtherStats(otherBalances: ValidatorCounts): Promise<void> {
    this.logger.info('Other ongoing validators [%d]', otherBalances.active);
    this.prometheus.validators.set({ owner: 'other', status: PrometheusValStatus.Ongoing }, otherBalances.active);
    this.prometheus.validators.set({ owner: 'other', status: PrometheusValStatus.Pending }, otherBalances.pending);
    this.prometheus.validators.set({ owner: 'other', status: PrometheusValStatus.Slashed }, otherBalances.slashed);
  }

  public async finalizeAppIterate(slot: bigint): Promise<void> {
    this.prometheus.slotTime = await this.dataProcessor.getSlotTime(slot);
    this.prometheus.slotNumber.set(Number(slot));
  }
}
