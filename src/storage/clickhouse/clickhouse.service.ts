import { Readable, Transform } from 'stream';

import { ClickHouseClient, createClient } from '@clickhouse/client';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { chain } from 'stream-chain';
import { batch } from 'stream-json/utils/Batch';

import { ConfigService } from 'common/config';
import { allSettled } from 'common/functions/allSettled';
import { retrier } from 'common/functions/retrier';
import { unblock } from 'common/functions/unblock';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { Epoch, Slot } from 'common/types/types';
import { EpochMeta, EpochPendingConsolidation, ValidatorDutySummary } from 'duty/summary';

import {
  avgChainRewardsAndPenaltiesStatsQuery,
  avgUserValidatorBalanceDeltaQuery,
  chainSyncParticipationAvgPercentQuery,
  epochMetadataQuery,
  epochProcessingQuery,
  otherChainWithdrawalsStatsQuery,
  otherConsolidationsCountQuery,
  otherSyncParticipationAvgPercentQuery,
  otherValidatorsSummaryStatsQuery,
  totalBalance24hDifferenceQuery,
  userConsolidationsCountQuery,
  userNodeOperatorsProposesStatsLastNEpochQuery,
  userNodeOperatorsRewardsAndPenaltiesStatsQuery,
  userNodeOperatorsStatsQuery,
  userNodeOperatorsWithdrawalsStatsQuery,
  userOperatorBalance24hDifferenceQuery,
  userOperatorsSyncParticipationAvgPercentsQuery,
  userSyncParticipationAvgPercentQuery,
  userValidatorQuantile0001BalanceDeltasQuery,
  userValidatorsCountWithNegativeDeltaQuery,
  userValidatorsSummaryStatsQuery,
  validatorCountByConditionAttestationLastNEpochQuery,
  validatorsCountByConditionProposeQuery,
  validatorsCountWithSyncParticipationByConditionLastNEpochQuery,
} from './clickhouse.constants';
import {
  AvgChainRewardsStats,
  EpochProcessingState,
  ModuleValidatorsStatusStats,
  NOsProposesStats,
  NOsValidatorsCountAndBalance,
  NOsValidatorsRewardsStats,
  NOsValidatorsStatusStats,
  NOsWithdrawalsStats,
  OtherValidatorsCountAndBalance,
  SyncCommitteeParticipationAvgPercents,
  UserNOsValidatorsCount,
  UserNOsValidatorsCountAndBalance,
  ValidatorsStatusBaseStats,
  WithdrawalsStats,
} from './clickhouse.types';
import migration_000000_summary from './migrations/migration_000000_summary';
import migration_000001_indexes from './migrations/migration_000001_indexes';
import migration_000002_rewards from './migrations/migration_000002_rewards';
import migration_000003_epoch_meta from './migrations/migration_000003_epoch_meta';
import migration_000004_epoch_processing from './migrations/migration_000004_epoch_processing';
import migration_000005_withdrawals from './migrations/migration_000005_withdrawals';
import migration_000006_stuck_validators from './migrations/migration_000006_stuck_validators';
import migration_000007_module_id from './migrations/migration_000007_module_id';
import migration_000008_last_not_missed_slot from './migrations/migration_000008_last_not_missed_slot';
import migration_000009_pending_consolidations from './migrations/migration_000009_pending_consolidations';

@Injectable()
export class ClickhouseService implements OnModuleInit {
  private readonly db: ClickHouseClient;
  private readonly maxRetries: number;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly retry: ReturnType<typeof retrier>;

  private async select<T>(query: string): Promise<T> {
    return await (await this.retry(async () => await this.db.query({ query, format: 'JSONEachRow' }))).json<T>();
  }

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

    this.db = createClient({
      host: `${this.config.get('DB_HOST')}:${this.config.get('DB_PORT')}`,
      username: this.config.get('DB_USER'),
      password: this.config.get('DB_PASSWORD'),
      database: this.config.get('DB_NAME'),
      compression: {
        response: false,
        request: false,
      },
    });
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

  public async getLastNotMissedSlotForEpoch(epoch: Epoch): Promise<{ slot: Slot }> {
    const data = (
      await this.select<{ last_not_missed_slot }[]>(`SELECT last_not_missed_slot FROM epochs_metadata WHERE epoch = ${epoch}`)
    )[0];
    if (data) {
      return { slot: data.last_not_missed_slot != null ? Number(data.last_not_missed_slot) : 0 };
    }

    return { slot: 0 };
  }

  @TrackTask('write-summary')
  public async writeSummary(summary: IterableIterator<ValidatorDutySummary>): Promise<void> {
    const runWriteTasks = (stream: Readable): Promise<any>[] => {
      const indexes = this.retry(async () =>
        this.db.insert({
          table: 'validators_index',
          values: stream.pipe(
            new Transform({
              transform(chunk, encoding, callback) {
                callback(null, { val_id: chunk.val_id, val_pubkey: chunk.val_pubkey });
              },
              objectMode: true,
            }),
          ),
          format: 'JSONEachRow',
        }),
      );

      const summaries = this.retry(async () =>
        this.db.insert({
          table: 'validators_summary',
          values: stream.pipe(
            new Transform({
              transform(chunk, encoding, callback) {
                callback(null, {
                  ...chunk,
                  val_balance: chunk.val_balance.toString(),
                  val_effective_balance: chunk.val_effective_balance.toString(),
                  val_balance_withdrawn: chunk.val_balance_withdrawn?.toString(),
                  propose_earned_reward: chunk.propose_earned_reward?.toString(),
                  propose_missed_reward: chunk.propose_missed_reward?.toString(),
                  propose_penalty: chunk.propose_penalty?.toString(),
                  sync_meta: undefined,
                  val_pubkey: undefined,
                });
              },
              objectMode: true,
            }),
          ),
          format: 'JSONEachRow',
        }),
      );

      return [indexes, summaries];
    };

    await allSettled(
      runWriteTasks(
        chain([
          Readable.from(summary, { objectMode: true, autoDestroy: true }),
          batch({ batchSize: 100 }),
          async (batch) => {
            await unblock();
            return batch;
          },
        ]),
      ),
    );
  }

  @TrackTask('write-pending-consolidations')
  public async writePendingConsolidations(epoch: Epoch, consolidations: EpochPendingConsolidation[]): Promise<void> {
    const runWriteTask = (stream: Readable): Promise<any> =>
      this.retry(async () =>
        this.db.insert({
          table: 'pending_consolidations',
          values: stream.pipe(
            new Transform({
              transform(chunk, encoding, callback) {
                callback(null, {
                  epoch,
                  source_val_id: chunk.source_index,
                  target_val_id: chunk.target_index,
                });
              },
              objectMode: true,
            }),
          ),
          format: 'JSONEachRow',
        }),
      );

    await runWriteTask(
      chain([
        Readable.from(consolidations, { objectMode: true, autoDestroy: true }),
        batch({ batchSize: 100 }),
        async (batch) => {
          await unblock();
          return batch;
        },
      ]),
    );
  }

  @TrackTask('write-epoch-meta')
  public async writeEpochMeta(epoch: Epoch, slot: Slot, meta: EpochMeta): Promise<void> {
    await this.retry(
      async () =>
        await this.db.insert({
          table: 'epochs_metadata',
          values: [
            {
              epoch,
              last_not_missed_slot: slot,
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
      migration_000005_withdrawals,
      migration_000006_stuck_validators,
      migration_000007_module_id,
      migration_000008_last_not_missed_slot,
      migration_000009_pending_consolidations,
    ];
    for (const query of migrations) {
      await this.db.exec({ query });
    }
  }

  public async getAvgValidatorBalanceDelta(epoch: Epoch): Promise<UserNOsValidatorsCount[]> {
    return (await this.select<UserNOsValidatorsCount[]>(avgUserValidatorBalanceDeltaQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getValidatorQuantile0001BalanceDeltas(epoch: Epoch): Promise<UserNOsValidatorsCount[]> {
    return (await this.select<UserNOsValidatorsCount[]>(userValidatorQuantile0001BalanceDeltasQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getUserValidatorsCountWithNegativeDelta(epoch: Epoch): Promise<UserNOsValidatorsCountAndBalance[]> {
    return (await this.select<UserNOsValidatorsCountAndBalance[]>(userValidatorsCountWithNegativeDeltaQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
      balance: BigInt(v.balance),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about User Sync Committee participants
   */
  public async getUserSyncParticipationAvgPercent(epoch: Epoch): Promise<SyncCommitteeParticipationAvgPercents[]> {
    return (await this.select<SyncCommitteeParticipationAvgPercents[]>(userSyncParticipationAvgPercentQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about Other Sync Committee average percent
   */
  public async getOtherSyncParticipationAvgPercent(epoch: Epoch): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.select(otherSyncParticipationAvgPercentQuery(epoch));
    return { amount: Number(ret[0].amount) };
  }

  /**
   * Send query to Clickhouse and receives information about Chain Sync Committee acg percent
   */
  public async getChainSyncParticipationAvgPercent(epoch: Epoch): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.select(chainSyncParticipationAvgPercentQuery(epoch));
    return { amount: Number(ret[0].amount) };
  }

  /**
   * Send query to Clickhouse and receives information about Operator Sync Committee participants
   */
  public async getOperatorSyncParticipationAvgPercents(epoch: Epoch): Promise<UserNOsValidatorsCount[]> {
    return (await this.select<UserNOsValidatorsCount[]>(userOperatorsSyncParticipationAvgPercentsQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getValidatorsCountWithGoodSyncParticipationLastNEpoch(
    epoch: Epoch,
    epochInterval: number,
    chainAvg: number,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsCountAndBalance[]> {
    return (
      await this.select<NOsValidatorsCountAndBalance[]>(
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
      balance: BigInt(v.balance),
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
  ): Promise<NOsValidatorsCountAndBalance[]> {
    return (
      await this.select<NOsValidatorsCountAndBalance[]>(
        validatorsCountWithSyncParticipationByConditionLastNEpochQuery(
          epoch,
          epochInterval,
          validatorIndexes,
          `sync_percent < abs(${chainAvg} - ${this.config.get('SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG')})`,
        ),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
      balance: BigInt(v.balance),
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
  ): Promise<NOsValidatorsCountAndBalance[]> {
    return (
      await this.select<NOsValidatorsCountAndBalance[]>(
        validatorCountByConditionAttestationLastNEpochQuery(epoch, epochInterval, validatorIndexes, condition),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
      balance: BigInt(v.balance),
    }));
  }

  public async getValidatorsCountWithGoodProposes(epoch: Epoch, validatorIndexes: string[] = []): Promise<NOsValidatorsCountAndBalance[]> {
    return (
      await this.select<NOsValidatorsCountAndBalance[]>(
        validatorsCountByConditionProposeQuery(epoch, validatorIndexes, 'block_proposed = 1'),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
      balance: BigInt(v.balance),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators miss proposals at our last processed epoch
   */
  public async getValidatorsCountWithMissedProposes(
    epoch: Epoch,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsCountAndBalance[]> {
    return (
      await this.select<NOsValidatorsCountAndBalance[]>(
        validatorsCountByConditionProposeQuery(epoch, validatorIndexes, 'block_proposed = 0'),
      )
    ).map((v) => ({
      ...v,
      amount: Number(v.amount),
      balance: BigInt(v.balance),
    }));
  }

  public async getTotalBalance24hDifference(epoch: Epoch): Promise<{ val_nos_module_id; amount }[]> {
    return (await this.select<{ val_nos_module_id; amount }[]>(totalBalance24hDifferenceQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
    }));
  }

  public async getOperatorBalance24hDifference(epoch: Epoch): Promise<UserNOsValidatorsCount[]> {
    return (await this.select<UserNOsValidatorsCount[]>(userOperatorBalance24hDifferenceQuery(epoch))).map((v) => ({
      ...v,
      amount: Number(v.amount),
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
      active_ongoing_balance: BigInt(v.active_ongoing_balance),
      pending: Number(v.pending),
      pending_balance: BigInt(v.pending_balance),
      slashed: Number(v.slashed),
      slashed_balance: BigInt(v.slashed_balance),
      withdraw_pending: Number(v.withdraw_pending),
      withdraw_pending_balance: BigInt(v.withdraw_pending_balance),
      withdrawn: Number(v.withdrawn),
      withdrawn_balance: BigInt(v.withdrawn_balance),
      stuck: Number(v.stuck),
      stuck_balance: BigInt(v.stuck_balance),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many User Node Operator validators have active, slashed, pending status
   */
  public async getUserValidatorsSummaryStats(epoch: Epoch): Promise<ModuleValidatorsStatusStats[]> {
    return (await this.select<ModuleValidatorsStatusStats[]>(userValidatorsSummaryStatsQuery(epoch))).map((v) => ({
      ...v,
      active_ongoing: Number(v.active_ongoing),
      active_ongoing_balance: BigInt(v.active_ongoing_balance),
      pending: Number(v.pending),
      pending_balance: BigInt(v.pending_balance),
      slashed: Number(v.slashed),
      slashed_balance: BigInt(v.slashed_balance),
      withdraw_pending: Number(v.withdraw_pending),
      withdraw_pending_balance: BigInt(v.withdraw_pending_balance),
      withdrawn: Number(v.withdrawn),
      withdrawn_balance: BigInt(v.withdrawn_balance),
      stuck: Number(v.stuck),
      stuck_balance: BigInt(v.stuck_balance),
    }));
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many other (not user) validators have active, slashed, pending status
   */
  public async getOtherValidatorsSummaryStats(epoch: Epoch): Promise<ValidatorsStatusBaseStats> {
    const ret = (await this.select(otherValidatorsSummaryStatsQuery(epoch))) as ValidatorsStatusBaseStats[];
    return {
      ...ret[0],
      active_ongoing: Number(ret[0].active_ongoing),
      active_ongoing_balance: BigInt(ret[0].active_ongoing_balance),
      pending: Number(ret[0].pending),
      pending_balance: BigInt(ret[0].pending_balance),
      slashed: Number(ret[0].slashed),
      slashed_balance: BigInt(ret[0].slashed_balance),
      withdraw_pending: Number(ret[0].withdraw_pending),
      withdraw_pending_balance: BigInt(ret[0].withdraw_pending_balance),
      withdrawn: Number(ret[0].withdrawn),
      withdrawn_balance: BigInt(ret[0].withdrawn_balance),
    };
  }

  /**
   * Send query to Clickhouse and receives information about
   * User Node Operator proposals stats in the last N epochs
   */
  public async getUserNodeOperatorsProposesStats(epoch: Epoch, epochInterval = 120): Promise<NOsProposesStats[]> {
    return (await this.select<NOsProposesStats[]>(userNodeOperatorsProposesStatsLastNEpochQuery(epoch, epochInterval))).map((v) => ({
      ...v,
      all: Number(v.all),
      missed: Number(v.missed),
    }));
  }

  async getEpochMetadata(epoch: Epoch): Promise<EpochMeta> {
    const ret = (await this.select(epochMetadataQuery(epoch)))[0];
    const metadata = {};
    if (ret) {
      metadata['state'] = {
        active_validators: Number(ret['active_validators']),
        active_validators_total_increments: BigInt(ret['active_validators_total_increments']),
        base_reward: Number(ret['base_reward']),
      };
      metadata['attestation'] = {
        blocks_rewards: new Map(ret['att_blocks_rewards'].map(([b, r]) => [Number(b), BigInt(r)])),
        participation: {
          source: BigInt(ret['att_source_participation']),
          target: BigInt(ret['att_target_participation']),
          head: BigInt(ret['att_head_participation']),
        },
      };
      metadata['sync'] = {
        blocks_rewards: new Map(ret['sync_blocks_rewards'].map(([b, r]) => [Number(b), BigInt(r)])),
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
    const ret = (await this.select(epochProcessingQuery(epoch)))[0];
    if (ret) return { ...ret, epoch: ret.epoch };
    return { epoch: 0, is_stored: undefined, is_calculated: undefined };
  }

  public async getUserNodeOperatorsRewardsAndPenaltiesStats(epoch: Epoch): Promise<NOsValidatorsRewardsStats[]> {
    return (await this.select<NOsValidatorsRewardsStats[]>(userNodeOperatorsRewardsAndPenaltiesStatsQuery(epoch))).map((v) => ({
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
    return (await this.select<AvgChainRewardsStats[]>(avgChainRewardsAndPenaltiesStatsQuery(epoch))).map((v) => ({
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

  public async getUserNodeOperatorsWithdrawalsStats(epoch: Epoch): Promise<NOsWithdrawalsStats[]> {
    return (await this.select<NOsWithdrawalsStats[]>(userNodeOperatorsWithdrawalsStatsQuery(epoch))).map((v) => ({
      ...v,
      full_withdrawn_sum: +v.full_withdrawn_sum,
      full_withdrawn_count: +v.full_withdrawn_count,
      partial_withdrawn_sum: +v.partial_withdrawn_sum,
      partial_withdrawn_count: +v.partial_withdrawn_count,
    }));
  }

  public async getOtherChainWithdrawalsStats(epoch: Epoch): Promise<WithdrawalsStats> {
    return (await this.select<WithdrawalsStats[]>(otherChainWithdrawalsStatsQuery(epoch))).map((v) => ({
      ...v,
      full_withdrawn_sum: +v.full_withdrawn_sum,
      full_withdrawn_count: +v.full_withdrawn_count,
      partial_withdrawn_sum: +v.partial_withdrawn_sum,
      partial_withdrawn_count: +v.partial_withdrawn_count,
    }))[0];
  }

  public async getUserValidatorsConsolidationCount(epoch: Epoch, type: 'source' | 'target'): Promise<UserNOsValidatorsCountAndBalance[]> {
    return (await this.select<UserNOsValidatorsCountAndBalance[]>(userConsolidationsCountQuery(epoch, type))).map((v) => ({
      ...v,
      amount: Number(v.amount),
      balance: BigInt(v.balance),
    }));
  }

  public async getOtherValidatorsConsolidationCount(epoch: Epoch, type: 'source' | 'target'): Promise<OtherValidatorsCountAndBalance> {
    const result = (await this.select<OtherValidatorsCountAndBalance[]>(otherConsolidationsCountQuery(epoch, type))).map((v) => ({
      amount: Number(v.amount),
      balance: BigInt(v.balance),
    }));

    return result.length > 0
      ? result[0]
      : {
          amount: 0,
          balance: 0n,
        };
  }
}
