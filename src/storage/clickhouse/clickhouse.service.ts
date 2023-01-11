import { ClickHouseClient, createClient } from '@clickhouse/client';
import { BigNumber } from '@ethersproject/bignumber';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/eth-providers/consensus-provider/types';
import { retrier } from 'common/functions/retrier';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { EpochMeta, ValidatorDutySummary } from 'duty/summary';

import {
  avgChainRewardsAndPenaltiesStats,
  avgValidatorBalanceDelta,
  chainSyncParticipationAvgPercentQuery,
  epochMetadata,
  epochProcessing,
  operatorBalance24hDifferenceQuery,
  operatorsSyncParticipationAvgPercentsQuery,
  otherSyncParticipationAvgPercentQuery,
  otherValidatorsSummaryStatsQuery,
  totalBalance24hDifferenceQuery,
  userNodeOperatorsProposesStatsLastNEpochQuery,
  userNodeOperatorsRewardsAndPenaltiesStats,
  userNodeOperatorsStatsQuery,
  userSyncParticipationAvgPercentQuery,
  userValidatorsSummaryStatsQuery,
  validatorCountByConditionAttestationLastNEpochQuery,
  validatorCountHighAvgIncDelayAttestationOfNEpochQuery,
  validatorQuantile0001BalanceDeltasQuery,
  validatorsCountByConditionMissProposeQuery,
  validatorsCountWithNegativeDeltaQuery,
  validatorsCountWithSyncParticipationByConditionLastNEpochQuery,
} from './clickhouse.constants';
import {
  AvgChainRewardsStats,
  EpochProcessingState,
  NOsDelta,
  NOsProposesStats,
  NOsValidatorsByConditionAttestationCount,
  NOsValidatorsByConditionProposeCount,
  NOsValidatorsNegDeltaCount,
  NOsValidatorsRewardsStats,
  NOsValidatorsStatusStats,
  NOsValidatorsSyncAvgPercent,
  NOsValidatorsSyncByConditionCount,
  SyncCommitteeParticipationAvgPercents,
  ValidatorsStatusStats,
} from './clickhouse.types';
import migration_000000_summary from './migrations/migration_000000_summary';
import migration_000001_indexes from './migrations/migration_000001_indexes';
import migration_000002_rewards from './migrations/migration_000002_rewards';
import migration_000003_epoch_meta from './migrations/migration_000003_epoch_meta';
import migration_000004_epoch_processing from './migrations/migration_000004_epoch_processing';

@Injectable()
export class ClickhouseService implements OnModuleInit {
  private readonly db: ClickHouseClient;
  private readonly maxRetries: number;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly chunkSize: number;
  private readonly retry: ReturnType<typeof retrier>;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
  ) {
    this.maxRetries = this.config.get('DB_MAX_RETRIES');
    this.minBackoff = this.config.get('DB_MIN_BACKOFF_SEC');
    this.maxBackoff = this.config.get('DB_MAX_BACKOFF_SEC');
    this.chunkSize = this.config.get('DB_INSERT_CHUNK_SIZE');

    this.logger.log(`DB backoff set to (min=[${this.minBackoff}], max=[${this.maxBackoff}] seconds`);
    this.logger.log(`DB max retries set to [${this.maxRetries}]`);

    this.retry = retrier(this.logger, this.maxRetries, this.minBackoff * 1000, this.maxBackoff * 1000, true);

    this.db = createClient({
      host: `${this.config.get('DB_HOST')}:${this.config.get('DB_PORT')}`,
      username: this.config.get('DB_USER'),
      password: this.config.get('DB_PASSWORD'),
      database: this.config.get('DB_NAME'),
      compression: {
        response: true,
        request: true,
      },
    });
  }

  private async select<T>(query: string): Promise<T> {
    return await (await this.retry(async () => await this.db.query({ query, format: 'JSONEachRow' }))).json<T>();
  }

  public async onModuleInit(): Promise<void> {
    await this.retry(async () => await this.migrate());
  }

  public async getLastProcessedEpoch(): Promise<EpochProcessingState> {
    const data = (
      await this.select<EpochProcessingState[]>(
        'SELECT epoch FROM epochs_processing WHERE is_stored = 1 AND is_calculated = 1 ORDER BY epoch DESC LIMIT 1',
      )
    )[0];
    if (data) return { ...data, epoch: Number(data.epoch) };
    return { epoch: 0, is_stored: undefined, is_calculated: undefined };
  }

  public async getLastEpoch(): Promise<EpochProcessingState> {
    const data = (await this.select<EpochProcessingState[]>('SELECT * FROM epochs_processing ORDER BY epoch DESC LIMIT 1'))[0];
    if (data) return { ...data, epoch: Number(data.epoch) };
    return { epoch: 0, is_stored: undefined, is_calculated: undefined };
  }

  public async getMaxEpoch(): Promise<{ max }> {
    const data = (await this.select<{ max }[]>('SELECT max(epoch) as max FROM validators_summary'))[0];
    if (data) return { max: Number(data.max) };
    return { max: 0 };
  }

  @TrackTask('write-summary')
  public async writeSummary(summary: ValidatorDutySummary[]): Promise<void> {
    while (summary.length > 0) {
      const chunk = summary.splice(0, this.chunkSize);
      await Promise.all([
        this.retry(
          async () =>
            await this.db.insert({
              table: 'validators_index',
              values: chunk.map((v) => ({ val_id: v.val_id, val_pubkey: v.val_pubkey })),
              format: 'JSONEachRow',
            }),
        ),
        this.retry(
          async () =>
            await this.db.insert({
              table: 'validators_summary',
              values: chunk.map((v) => ({ ...v, val_pubkey: undefined })),
              format: 'JSONEachRow',
            }),
        ),
      ]);
    }
  }

  @TrackTask('write-epoch-meta')
  public async writeEpochMeta(epoch: Epoch, meta: EpochMeta): Promise<void> {
    await this.retry(
      async () =>
        await this.db.insert({
          table: 'epochs_metadata',
          values: [
            {
              epoch,
              active_validators: meta.state.active_validators,
              active_validators_total_increments: meta.state.active_validators_total_increments.toString(),
              base_reward: meta.state.base_reward,
              att_blocks_rewards: Array.from(meta.attestation.blocks_rewards).map(([b, r]) => [b, r.toString()]),
              att_source_participation: meta.attestation.participation.source.toString(),
              att_target_participation: meta.attestation.participation.target.toString(),
              att_head_participation: meta.attestation.participation.head.toString(),
              sync_blocks_rewards: Array.from(meta.sync.blocks_rewards).map(([b, r]) => [b, r.toString()]),
              sync_blocks_to_sync: meta.sync.blocks_to_sync,
            },
          ],
          format: 'JSONEachRow',
        }),
    );
  }

  @TrackTask('update-epoch-processing')
  public async updateEpochProcessing(state: EpochProcessingState): Promise<void> {
    const old = await this.getOrInitEpochProcessing(state.epoch);
    const updates = [];
    if (state.is_stored != undefined) updates.push(`is_stored = ${+state.is_stored}`);
    if (state.is_calculated != undefined) updates.push(`is_calculated = ${+state.is_calculated}`);
    await this.retry(
      async () => await this.db.exec({ query: `ALTER TABLE epochs_processing UPDATE ${updates.join(', ')} WHERE epoch = ${state.epoch}` }),
    );
    // update is heavy operation for clickhouse, and it takes some time
    await this.retry(async () => {
      const updated = await this.getOrInitEpochProcessing(state.epoch);
      if (old.is_stored == updated.is_stored && old.is_calculated == updated.is_calculated) {
        throw Error('Epoch processing info is not updated yet');
      }
    });
  }

  public async migrate(): Promise<void> {
    this.logger.log('Running migrations');
    const migrations = [
      migration_000000_summary,
      migration_000001_indexes,
      migration_000002_rewards,
      migration_000003_epoch_meta,
      migration_000004_epoch_processing,
    ];
    for (const query of migrations) {
      await this.db.exec({ query });
    }
  }

  public async getAvgValidatorBalanceDelta(epoch: Epoch): Promise<NOsDelta[]> {
    return (await this.select<NOsDelta[]>(avgValidatorBalanceDelta(epoch))).map((v) => ({
      ...v,
      delta: Number(v.delta),
    }));
  }

  public async getValidatorQuantile0001BalanceDeltas(epoch: Epoch): Promise<NOsDelta[]> {
    return (await this.select<NOsDelta[]>(validatorQuantile0001BalanceDeltasQuery(epoch))).map((v) => ({
      ...v,
      delta: Number(v.delta),
    }));
  }

  public async getValidatorsCountWithNegativeDelta(epoch: Epoch): Promise<NOsValidatorsNegDeltaCount[]> {
    return (await this.select<NOsValidatorsNegDeltaCount[]>(validatorsCountWithNegativeDeltaQuery(epoch))).map((v) => ({
      ...v,
      neg_count: Number(v.neg_count),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about User Sync Committee participants
   */
  public async getUserSyncParticipationAvgPercent(epoch: Epoch): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.select(userSyncParticipationAvgPercentQuery(epoch));
    return { avg_percent: Number(ret[0].avg_percent) };
  }

  /**
   * Send query to Clickhouse and receives information about Other Sync Committee avg percent
   */
  public async getOtherSyncParticipationAvgPercent(epoch: Epoch): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.select(otherSyncParticipationAvgPercentQuery(epoch));
    return { avg_percent: Number(ret[0].avg_percent) };
  }

  /**
   * Send query to Clickhouse and receives information about Chain Sync Committee acg percent
   */
  public async getChainSyncParticipationAvgPercent(epoch: Epoch): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.select(chainSyncParticipationAvgPercentQuery(epoch));
    return { avg_percent: Number(ret[0].avg_percent) };
  }

  /**
   * Send query to Clickhouse and receives information about Operator Sync Committee participants
   */
  public async getOperatorSyncParticipationAvgPercents(epoch: Epoch): Promise<NOsValidatorsSyncAvgPercent[]> {
    return (await this.select<NOsValidatorsSyncAvgPercent[]>(operatorsSyncParticipationAvgPercentsQuery(epoch))).map((v) => ({
      ...v,
      avg_percent: Number(v.avg_percent),
    }));
  }

  public async getValidatorsCountWithGoodSyncParticipationLastNEpoch(
    epoch: Epoch,
    epochInterval: number,
    chainAvg: number,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsSyncByConditionCount[]> {
    return (
      await this.select<NOsValidatorsSyncByConditionCount[]>(
        validatorsCountWithSyncParticipationByConditionLastNEpochQuery(
          epoch,
          epochInterval,
          validatorIndexes,
          `sync_percent >= (${chainAvg} - ${this.config.get('SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG')})`,
        ),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have Sync Committee participation less when chain average last N epoch
   */
  public async getValidatorsCountWithBadSyncParticipationLastNEpoch(
    epoch: Epoch,
    epochInterval: number,
    chainAvg: number,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsSyncByConditionCount[]> {
    return (
      await this.select<NOsValidatorsSyncByConditionCount[]>(
        validatorsCountWithSyncParticipationByConditionLastNEpochQuery(
          epoch,
          epochInterval,
          validatorIndexes,
          `sync_percent < (${chainAvg} - ${this.config.get('SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG')})`,
        ),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getValidatorCountWithPerfectAttestationsLastEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      1,
      'att_happened = 1 AND att_inc_delay = 1 AND att_valid_head = 1 AND att_valid_target = 1 AND att_valid_source = 1',
    );
  }

  public async getValidatorCountWithMissedAttestationsLastEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 0');
  }

  public async getValidatorCountWithHighIncDelayAttestationsLastEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 1 AND att_inc_delay > 1');
  }

  public async getValidatorCountWithInvalidHeadAttestationsLastEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 1 AND att_valid_head = 0');
  }

  public async getValidatorCountWithInvalidTargetAttestationsLastEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 1 AND att_valid_target = 0');
  }

  public async getValidatorCountWithInvalidSourceAttestationsLastEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 1 AND att_valid_source = 0');
  }

  public async getValidatorCountWithMissedAttestationsLastNEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_happened = 0',
    );
  }

  public async getValidatorCountWithHighRewardMissedAttestationsLastNEpoch(epoch: Epoch, possibleHighRewardValidators: string[]) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_happened = 0',
      possibleHighRewardValidators,
    );
  }

  public async getValidatorCountIncDelayGtOneAttestationsLastNEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_happened = 1 AND att_inc_delay > 1',
    );
  }

  public async getValidatorCountIncDelayGtTwoAttestationsLastNEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_happened = 1 AND att_inc_delay > 2',
    );
  }

  public async getValidatorCountWithInvalidHeadAttestationsLastNEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_valid_head = 0',
    );
  }

  public async getValidatorCountWithInvalidTargetAttestationsLastNEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_valid_target = 0',
    );
  }

  public async getValidatorCountWithInvalidSourceAttestationsLastNEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_valid_source = 0',
    );
  }

  public async getValidatorCountWithInvalidAttestationsPropertyGtOneLastNEpoch(epoch: Epoch) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      '(att_valid_head + att_valid_target + att_valid_source = 1)',
    );
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators match condition
   */
  private async getValidatorCountByConditionAttestationsLastNEpoch(
    epoch: Epoch,
    epochInterval: number,
    condition: string,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsByConditionAttestationCount[]> {
    return (
      await this.select<NOsValidatorsByConditionAttestationCount[]>(
        validatorCountByConditionAttestationLastNEpochQuery(epoch, epochInterval, validatorIndexes, condition),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have high avg inc. delay (>2) last N epoch
   */
  public async getValidatorCountHighAvgIncDelayAttestationOfNEpochQuery(epoch: Epoch): Promise<NOsValidatorsByConditionAttestationCount[]> {
    return (
      await this.select<NOsValidatorsByConditionAttestationCount[]>(
        validatorCountHighAvgIncDelayAttestationOfNEpochQuery(epoch, this.config.get('BAD_ATTESTATION_EPOCHS')),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getValidatorsCountWithGoodProposes(
    epoch: Epoch,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsByConditionProposeCount[]> {
    return (
      await this.select<NOsValidatorsByConditionProposeCount[]>(
        validatorsCountByConditionMissProposeQuery(epoch, validatorIndexes, 'block_proposed = 1'),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators miss proposes at our last processed epoch
   */
  public async getValidatorsCountWithMissedProposes(
    epoch: Epoch,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsByConditionProposeCount[]> {
    return (
      await this.select<NOsValidatorsByConditionProposeCount[]>(
        validatorsCountByConditionMissProposeQuery(epoch, validatorIndexes, 'block_proposed = 0'),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getTotalBalance24hDifference(epoch: Epoch): Promise<number | undefined> {
    const ret = await this.select<{ curr_total_balance; prev_total_balance; total_diff }[]>(totalBalance24hDifferenceQuery(epoch));

    if (ret.length < 1) {
      return undefined;
    }

    const { curr_total_balance, prev_total_balance, total_diff } = ret[0];

    if (!curr_total_balance || !prev_total_balance) {
      return undefined;
    }

    return Number(total_diff);
  }

  public async getOperatorBalance24hDifference(epoch: Epoch): Promise<{ val_nos_id; diff }[]> {
    return (await this.select<{ val_nos_id; diff }[]>(operatorBalance24hDifferenceQuery(epoch))).map((v) => ({
      ...v,
      diff: Number(v.diff),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have active, slashed, pending status
   */
  public async getUserNodeOperatorsStats(epoch: Epoch): Promise<NOsValidatorsStatusStats[]> {
    return (await this.select<NOsValidatorsStatusStats[]>(userNodeOperatorsStatsQuery(epoch))).map((v) => ({
      ...v,
      active_ongoing: Number(v.active_ongoing),
      pending: Number(v.pending),
      slashed: Number(v.slashed),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many User Node Operator validators have active, slashed, pending status
   */
  public async getUserValidatorsSummaryStats(epoch: Epoch): Promise<ValidatorsStatusStats> {
    const ret = await this.select(userValidatorsSummaryStatsQuery(epoch));
    return { active_ongoing: Number(ret[0].active_ongoing), pending: Number(ret[0].pending), slashed: Number(ret[0].slashed) };
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many other (not user) validators have active, slashed, pending status
   */
  public async getOtherValidatorsSummaryStats(epoch: Epoch): Promise<ValidatorsStatusStats> {
    const ret = await this.select(otherValidatorsSummaryStatsQuery(epoch));
    return { active_ongoing: Number(ret[0].active_ongoing), pending: Number(ret[0].pending), slashed: Number(ret[0].slashed) };
  }

  /**
   * Send query to Clickhouse and receives information about
   * User Node Operator proposes stats in the last N epochs
   */
  public async getUserNodeOperatorsProposesStats(epoch: Epoch, epochInterval = 120): Promise<NOsProposesStats[]> {
    return (await this.select<NOsProposesStats[]>(userNodeOperatorsProposesStatsLastNEpochQuery(epoch, epochInterval))).map((v) => ({
      ...v,
      all: Number(v.all),
      missed: Number(v.missed),
    }));
  }

  async getEpochMetadata(epoch: Epoch): Promise<EpochMeta> {
    const ret = (await this.select(epochMetadata(epoch)))[0];
    const metadata = {};
    if (ret) {
      metadata['state'] = {
        active_validators: Number(ret['active_validators']),
        active_validators_total_increments: BigNumber.from(ret['active_validators_total_increments']),
        base_reward: Number(ret['base_reward']),
      };
      metadata['attestation'] = {
        blocks_rewards: new Map(ret['att_blocks_rewards'].map(([b, r]) => [Number(b), BigNumber.from(r)])),
        participation: {
          source: BigNumber.from(ret['att_source_participation']),
          target: BigNumber.from(ret['att_target_participation']),
          head: BigNumber.from(ret['att_head_participation']),
        },
      };
      metadata['sync'] = {
        blocks_rewards: new Map(ret['sync_blocks_rewards'].map(([b, r]) => [Number(b), BigNumber.from(r)])),
        blocks_to_sync: ret['sync_blocks_to_sync'].map((b) => Number(b)),
      };
    }
    return metadata;
  }

  public async getOrInitEpochProcessing(epoch: Epoch): Promise<EpochProcessingState> {
    const curr = await this.getEpochProcessing(epoch);
    if (curr.epoch == 0) {
      await this.retry(
        async () =>
          await this.db.insert({
            table: 'epochs_processing',
            values: [{ epoch }],
            format: 'JSONEachRow',
          }),
      );
      // just for readability
      return { epoch, is_stored: undefined, is_calculated: undefined };
    }
    return curr;
  }

  public async getEpochProcessing(epoch: Epoch): Promise<EpochProcessingState> {
    const ret = (await this.select(epochProcessing(epoch)))[0];
    if (ret) return { ...ret, epoch: ret.epoch };
    return { epoch: 0, is_stored: undefined, is_calculated: undefined };
  }

  public async getUserNodeOperatorsRewardsAndPenaltiesStats(epoch: Epoch): Promise<NOsValidatorsRewardsStats[]> {
    return (await this.select<NOsValidatorsRewardsStats[]>(userNodeOperatorsRewardsAndPenaltiesStats(epoch))).map((v) => ({
      ...v,
      prop_reward: +v.prop_reward,
      prop_missed: +v.prop_missed,
      prop_penalty: +v.prop_penalty,
      sync_reward: +v.sync_reward,
      sync_missed: +v.sync_missed,
      sync_penalty: +v.sync_penalty,
      att_reward: +v.att_reward,
      att_missed: +v.att_missed,
      att_penalty: +v.att_penalty,
      total_reward: +v.total_reward,
      total_missed: +v.total_missed,
      total_penalty: +v.total_penalty,
      calculated_balance_change: +v.calculated_balance_change,
      real_balance_change: +v.real_balance_change,
      calculation_error: +v.calculation_error,
    }));
  }

  public async getAvgChainRewardsAndPenaltiesStats(epoch: Epoch): Promise<AvgChainRewardsStats> {
    return (await this.select<AvgChainRewardsStats[]>(avgChainRewardsAndPenaltiesStats(epoch))).map((v) => ({
      prop_reward: +v.prop_reward,
      prop_missed: +v.prop_missed,
      prop_penalty: +v.prop_penalty,
      sync_reward: +v.sync_reward,
      sync_missed: +v.sync_missed,
      sync_penalty: +v.sync_penalty,
      att_reward: +v.att_reward,
      att_missed: +v.att_missed,
      att_penalty: +v.att_penalty,
    }))[0];
  }
}
