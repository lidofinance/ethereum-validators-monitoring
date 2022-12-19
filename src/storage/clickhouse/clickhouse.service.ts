import { Duplex, Readable } from 'stream';

import { ClickHouseClient, createClient } from '@clickhouse/client';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { retrier } from 'common/functions/retrier';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { EpochMeta } from 'duty/summary';

import {
  avgValidatorBalanceDelta,
  calculatedBalanceDelta,
  chainSyncParticipationAvgPercentQuery,
  epochMetadata,
  operatorBalance24hDifferenceQuery,
  operatorBalanceDeltaQuery,
  operatorBalanceQuery,
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

@Injectable()
export class ClickhouseService implements OnModuleInit {
  private readonly db: ClickHouseClient;
  private readonly maxRetries: number;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly retry: ReturnType<typeof retrier>;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
  ) {
    this.maxRetries = this.config.get('DB_MAX_RETRIES');
    this.minBackoff = this.config.get('DB_MIN_BACKOFF_SEC');
    this.maxBackoff = this.config.get('DB_MAX_BACKOFF_SEC');

    this.logger.log(`DB backoff set to (min=[${this.minBackoff}], max=[${this.maxBackoff}] seconds`);
    this.logger.log(`DB max retries set to [${this.maxRetries}]`);

    this.retry = retrier(this.logger, this.maxRetries, this.minBackoff * 1000, this.maxBackoff * 1000, true);

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt#use_within_json
    BigInt.prototype['toJSON'] = function () {
      return this.toString();
    };

    this.db = createClient({
      host: `${this.config.get('DB_HOST')}:${this.config.get('DB_PORT')}`,
      username: this.config.get('DB_USER'),
      password: this.config.get('DB_PASSWORD'),
      database: this.config.get('DB_NAME'),
    });
  }

  private async select<T>(query: string): Promise<T> {
    return await (await this.retry(async () => await this.db.query({ query, format: 'JSONEachRow' }))).json<T>();
  }

  public async onModuleInit(): Promise<void> {
    await this.retry(async () => await this.migrate());
  }

  public async getMaxEpoch(): Promise<bigint> {
    const data = await this.select<{ max: string }[]>('SELECT max(epoch) as max FROM validators_summary');
    const epoch = BigInt(parseInt(data[0].max, 10) || 0);

    this.logger.log(`Max (latest) stored epoch in DB [${epoch}]`);

    return epoch;
  }

  @TrackTask('write-indexes')
  public async writeIndexes(pipeline: Duplex): Promise<void> {
    await this.db
      .insert({
        table: 'validators_index',
        values: pipeline,
        format: 'JSONEachRow',
      })
      .finally(() => pipeline.destroy());
  }

  @TrackTask('write-summary')
  public async writeSummary(stream: Readable): Promise<void> {
    await this.db
      .insert({
        table: 'validators_summary',
        values: stream,
        format: 'JSONEachRow',
      })
      .finally(() => stream.destroy());
  }

  @TrackTask('write-epoch-meta')
  public async writeEpochMeta(epoch: bigint, meta: EpochMeta): Promise<void> {
    await this.db.insert({
      table: 'epochs_metadata',
      values: [
        {
          epoch,
          active_validators: meta.state.active_validators,
          active_validators_total_increments: meta.state.active_validators_total_increments,
          base_reward: meta.state.base_reward,
          att_blocks_rewards: Array.from(meta.attestation.blocks_rewards),
          att_correct_source: meta.attestation.correct_source,
          att_correct_target: meta.attestation.correct_target,
          att_correct_head: meta.attestation.correct_head,
          sync_blocks_rewards: Array.from(meta.sync.blocks_rewards),
          sync_blocks_to_sync: meta.sync.blocks_to_sync,
        },
      ],
      format: 'JSONEachRow',
    });
  }

  public async migrate(): Promise<void> {
    this.logger.log('Running migrations');
    await this.db.exec({ query: migration_000000_summary });
    await this.db.exec({ query: migration_000001_indexes });
    await this.db.exec({ query: migration_000002_rewards });
    await this.db.exec({ query: migration_000003_epoch_meta });
  }

  public async getAvgValidatorBalanceDelta(epoch: bigint): Promise<NOsDelta[]> {
    return (await this.select<NOsDelta[]>(avgValidatorBalanceDelta(epoch))).map((v) => ({
      ...v,
      delta: Number(v.delta),
    }));
  }

  public async getOperatorBalanceQuery(epoch: bigint): Promise<{ val_nos_name; amount }[]> {
    return (await this.select<{ val_nos_name; amount }[]>(operatorBalanceQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getOperatorRealBalanceDeltaQuery(epoch: bigint): Promise<{ val_nos_name; amount }[]> {
    return (await this.select<{ val_nos_name; amount }[]>(operatorBalanceDeltaQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getOperatorCalculatedBalanceDeltaQuery(epoch: bigint): Promise<{ val_nos_name; amount }[]> {
    return (await this.select<{ val_nos_name; balance_change }[]>(calculatedBalanceDelta(epoch))).map((v) => ({
      ...v,
      amount: Number(v.balance_change),
    }));
  }

  public async getValidatorQuantile0001BalanceDeltas(epoch: bigint): Promise<NOsDelta[]> {
    return (await this.select<NOsDelta[]>(validatorQuantile0001BalanceDeltasQuery(epoch))).map((v) => ({
      ...v,
      delta: Number(v.delta),
    }));
  }

  public async getValidatorsCountWithNegativeDelta(epoch: bigint): Promise<NOsValidatorsNegDeltaCount[]> {
    return (await this.select<NOsValidatorsNegDeltaCount[]>(validatorsCountWithNegativeDeltaQuery(epoch))).map((v) => ({
      ...v,
      neg_count: Number(v.neg_count),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about User Sync Committee participants
   */
  public async getUserSyncParticipationAvgPercent(epoch: bigint): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.select(userSyncParticipationAvgPercentQuery(epoch));
    return { avg_percent: Number(ret[0].avg_percent) };
  }

  /**
   * Send query to Clickhouse and receives information about Other Sync Committee avg percent
   */
  public async getOtherSyncParticipationAvgPercent(epoch: bigint): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.select(otherSyncParticipationAvgPercentQuery(epoch));
    return { avg_percent: Number(ret[0].avg_percent) };
  }

  /**
   * Send query to Clickhouse and receives information about Chain Sync Committee acg percent
   */
  public async getChainSyncParticipationAvgPercent(epoch: bigint): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.select(chainSyncParticipationAvgPercentQuery(epoch));
    return { avg_percent: Number(ret[0].avg_percent) };
  }

  /**
   * Send query to Clickhouse and receives information about Operator Sync Committee participants
   */
  public async getOperatorSyncParticipationAvgPercents(epoch: bigint): Promise<NOsValidatorsSyncAvgPercent[]> {
    return (await this.select<NOsValidatorsSyncAvgPercent[]>(operatorsSyncParticipationAvgPercentsQuery(epoch))).map((v) => ({
      ...v,
      avg_percent: Number(v.avg_percent),
    }));
  }

  public async getValidatorsCountWithGoodSyncParticipationLastNEpoch(
    epoch: bigint,
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
    epoch: bigint,
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

  public async getValidatorCountWithPerfectAttestationsLastEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      1,
      'att_happened = 1 AND att_inc_delay = 1 AND att_valid_head = 1 AND att_valid_target = 1 AND att_valid_source = 1',
    );
  }

  public async getValidatorCountWithMissedAttestationsLastEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 0');
  }

  public async getValidatorCountWithHighIncDelayAttestationsLastEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 1 AND att_inc_delay > 1');
  }

  public async getValidatorCountWithInvalidHeadAttestationsLastEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 1 AND att_valid_head = 0');
  }

  public async getValidatorCountWithInvalidTargetAttestationsLastEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 1 AND att_valid_target = 0');
  }

  public async getValidatorCountWithInvalidSourceAttestationsLastEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(epoch, 1, 'att_happened = 1 AND att_valid_source = 0');
  }

  public async getValidatorCountWithMissedAttestationsLastNEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_happened = 0',
    );
  }

  public async getValidatorCountWithHighRewardMissedAttestationsLastNEpoch(epoch: bigint, possibleHighRewardValidators: string[]) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_happened = 0',
      possibleHighRewardValidators,
    );
  }

  public async getValidatorCountIncDelayGtOneAttestationsLastNEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_happened = 1 AND att_inc_delay > 1',
    );
  }

  public async getValidatorCountIncDelayGtTwoAttestationsLastNEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_happened = 1 AND att_inc_delay > 2',
    );
  }

  public async getValidatorCountWithInvalidHeadAttestationsLastNEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_valid_head = 0',
    );
  }

  public async getValidatorCountWithInvalidTargetAttestationsLastNEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_valid_target = 0',
    );
  }

  public async getValidatorCountWithInvalidSourceAttestationsLastNEpoch(epoch: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      epoch,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'att_valid_source = 0',
    );
  }

  public async getValidatorCountWithInvalidAttestationsPropertyGtOneLastNEpoch(epoch: bigint) {
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
    epoch: bigint,
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
  public async getValidatorCountHighAvgIncDelayAttestationOfNEpochQuery(
    epoch: bigint,
  ): Promise<NOsValidatorsByConditionAttestationCount[]> {
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
    epoch: bigint,
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
    epoch: bigint,
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

  public async getTotalBalance24hDifference(epoch: bigint): Promise<number | undefined> {
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

  public async getOperatorBalance24hDifference(epoch: bigint): Promise<{ val_nos_id; diff }[]> {
    return (await this.select<{ val_nos_id; diff }[]>(operatorBalance24hDifferenceQuery(epoch))).map((v) => ({
      ...v,
      diff: Number(v.diff),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have active, slashed, pending status
   */
  public async getUserNodeOperatorsStats(epoch: bigint): Promise<NOsValidatorsStatusStats[]> {
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
  public async getUserValidatorsSummaryStats(epoch: bigint): Promise<ValidatorsStatusStats> {
    const ret = await this.select(userValidatorsSummaryStatsQuery(epoch));
    return { active_ongoing: Number(ret[0].active_ongoing), pending: Number(ret[0].pending), slashed: Number(ret[0].slashed) };
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many other (not user) validators have active, slashed, pending status
   */
  public async getOtherValidatorsSummaryStats(epoch: bigint): Promise<ValidatorsStatusStats> {
    const ret = await this.select(otherValidatorsSummaryStatsQuery(epoch));
    return { active_ongoing: Number(ret[0].active_ongoing), pending: Number(ret[0].pending), slashed: Number(ret[0].slashed) };
  }

  /**
   * Send query to Clickhouse and receives information about
   * User Node Operator proposes stats in the last N epochs
   */
  public async getUserNodeOperatorsProposesStats(epoch: bigint, epochInterval = 120): Promise<NOsProposesStats[]> {
    return (await this.select<NOsProposesStats[]>(userNodeOperatorsProposesStatsLastNEpochQuery(epoch, epochInterval))).map((v) => ({
      ...v,
      all: Number(v.all),
      missed: Number(v.missed),
    }));
  }

  async getEpochMetadata(epoch: bigint): Promise<EpochMeta> {
    const ret = (await this.select(epochMetadata(epoch)))[0];
    const metadata = {};
    if (ret) {
      metadata['state'] = {
        active_validators: BigInt(ret['active_validators']),
        active_validators_total_increments: BigInt(ret['active_validators_total_increments']),
        base_reward: Number(ret['base_reward']),
      };
      metadata['attestation'] = {
        blocks_rewards: new Map(ret['att_blocks_rewards'].map(([b, r]) => [BigInt(b), BigInt(r)])),
        correct_source: Number(ret['att_correct_source']),
        correct_target: Number(ret['att_correct_target']),
        correct_head: Number(ret['att_correct_head']),
      };
      metadata['sync'] = {
        blocks_rewards: new Map(ret['sync_blocks_rewards'].map(([b, r]) => [BigInt(b), BigInt(r)])),
        blocks_to_sync: ret['sync_blocks_to_sync'].map((b) => BigInt(b)),
      };
    }
    return metadata;
  }

  public async getUserNodeOperatorsRewardsAndPenaltiesStats(epoch: bigint): Promise<NOsValidatorsRewardsStats[]> {
    return (await this.select<NOsValidatorsRewardsStats[]>(userNodeOperatorsRewardsAndPenaltiesStats(epoch))).map((v) => ({
      ...v,
      prop_reward: +v.prop_reward,
      prop_missed: +v.prop_missed,
      prop_penalty: +v.prop_penalty,
      sync_reward: +v.sync_reward,
      sync_missed: +v.sync_missed,
      sync_penalty: +v.sync_penalty,
      attestation_reward: +v.attestation_reward,
      attestation_missed: +v.attestation_missed,
      attestation_penalty: +v.attestation_penalty,
    }));
  }
}
