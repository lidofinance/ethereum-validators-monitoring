import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { ClickHouse } from 'clickhouse';

import { ConfigService } from 'common/config';
import { StateValidatorResponse } from 'common/eth-providers';
import { retrier } from 'common/functions/retrier';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { ValidatorDutySummary } from 'duty/summary';

import {
  chainSyncParticipationAvgPercentQuery,
  operatorBalance24hDifferenceQuery,
  operatorsSyncParticipationAvgPercentsQuery,
  otherSyncParticipationAvgPercentQuery,
  otherValidatorsSummaryStatsQuery,
  totalBalance24hDifferenceQuery,
  userNodeOperatorsProposesStatsLastNEpochQuery,
  userNodeOperatorsStatsQuery,
  userSyncParticipationAvgPercentQuery,
  userValidatorsSummaryStatsQuery,
  validatorBalancesDeltaQuery,
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
  NOsValidatorsStatusStats,
  NOsValidatorsSyncAvgPercent,
  NOsValidatorsSyncByConditionCount,
  SyncCommitteeParticipationAvgPercents,
  ValidatorsStatusStats,
} from './clickhouse.types';
import migration_000000_summary from './migrations/migration_000000_summary';
import migration_000001_indexes from './migrations/migration_000001_indexes';

@Injectable()
export class ClickhouseService implements OnModuleInit {
  private readonly db: ClickHouse;
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

    this.db = new ClickHouse({
      url: this.config.get('DB_HOST'),
      port: parseInt(this.config.get('DB_PORT'), 10),
      config: {
        database: this.config.get('DB_NAME'),
      },
      basicAuth: {
        username: this.config.get('DB_USER'),
        password: this.config.get('DB_PASSWORD'),
      },
      isSessionPerQuery: true,
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.retry(async () => await this.migrate());
  }

  public async getMaxEpoch(): Promise<bigint> {
    const data: any = await this.retry(async () => await this.db.query('SELECT max(epoch) as max FROM validators_summary').toPromise());
    const epoch = BigInt(parseInt(data[0].max, 10) || 0);

    this.logger.log(`Max (latest) stored epoch in DB [${epoch}]`);

    return epoch;
  }

  @TrackTask('write-indexes')
  public async writeIndexes(states: StateValidatorResponse[]): Promise<void> {
    const statesCopy = [...states];
    while (statesCopy.length > 0) {
      const chunk = statesCopy.splice(0, this.chunkSize);
      const ws = this.db.insert('INSERT INTO validators_index ' + '(val_id, val_pubkey) VALUES').stream();
      for (const v of chunk) {
        await ws.writeRow(`(${v.index}, '${v.validator.pubkey}')`);
      }
      await this.retry(async () => await ws.exec().finally(() => ws.destroy()));
    }
  }

  @TrackTask('write-summary')
  public async writeSummary(summary: ValidatorDutySummary[]): Promise<void> {
    while (summary.length > 0) {
      const chunk = summary.splice(0, this.chunkSize);
      const ws = this.db
        .insert(
          'INSERT INTO validators_summary ' +
            '(epoch, val_id, val_nos_id, val_nos_name, ' +
            'val_slashed, val_status, val_balance, is_proposer, block_to_propose, block_proposed, ' +
            'is_sync, sync_percent, ' +
            'att_happened, att_inc_delay, att_valid_head, att_valid_target, att_valid_source) VALUES',
        )
        .stream();
      for (const v of chunk) {
        await ws.writeRow(
          `(${v.epoch}, ${v.val_id}, ` +
            `${v.val_nos_id ?? 'NULL'}, ` +
            `'${v.val_nos_name ?? 'NULL'}', ` +
            `${v.val_slashed ? 1 : 0}, '${v.val_status}', ${v.val_balance}, ` +
            `${v.is_proposer ? 1 : 0}, ${v.block_to_propose ?? 'NULL'}, ${v.is_proposer ? (v.block_proposed ? 1 : 0) : 'NULL'}, ` +
            `${v.is_sync ? 1 : 0}, ${v.sync_percent ?? 'NULL'}, ` +
            `${v.att_happened != undefined ? (v.att_happened ? 1 : 0) : 'NULL'}, ${v.att_inc_delay ?? 'NULL'}, ` +
            `${v.att_valid_head ?? 'NULL'}, ${v.att_valid_target ?? 'NULL'}, ${v.att_valid_source ?? 'NULL'}
            )`,
        );
      }
      await this.retry(async () => await ws.exec().finally(() => ws.destroy()));
    }
  }

  public async migrate(): Promise<void> {
    this.logger.log('Running migrations');
    await this.db.query(migration_000000_summary).toPromise();
    await this.db.query(migration_000001_indexes).toPromise();
  }

  public async getValidatorBalancesDelta(epoch: bigint): Promise<NOsDelta[]> {
    const ret = await this.retry(async () => await this.db.query(validatorBalancesDeltaQuery(epoch)).toPromise());
    return <NOsDelta[]>ret;
  }

  public async getValidatorQuantile0001BalanceDeltas(epoch: bigint): Promise<NOsDelta[]> {
    const ret = await this.retry(async () => this.db.query(validatorQuantile0001BalanceDeltasQuery(epoch)).toPromise());
    return <NOsDelta[]>ret;
  }

  public async getValidatorsCountWithNegativeDelta(epoch: bigint): Promise<NOsValidatorsNegDeltaCount[]> {
    const ret = await this.retry(async () => this.db.query(validatorsCountWithNegativeDeltaQuery(epoch)).toPromise());
    return <NOsValidatorsNegDeltaCount[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about User Sync Committee participants
   */
  public async getUserSyncParticipationAvgPercent(epoch: bigint): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.retry(async () => this.db.query(userSyncParticipationAvgPercentQuery(epoch)).toPromise());
    return <SyncCommitteeParticipationAvgPercents>ret[0];
  }

  /**
   * Send query to Clickhouse and receives information about Other Sync Committee avg percent
   */
  public async getOtherSyncParticipationAvgPercent(epoch: bigint): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.retry(async () => this.db.query(otherSyncParticipationAvgPercentQuery(epoch)).toPromise());
    return <SyncCommitteeParticipationAvgPercents>ret[0];
  }

  /**
   * Send query to Clickhouse and receives information about Chain Sync Committee acg percent
   */
  public async getChainSyncParticipationAvgPercent(epoch: bigint): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.retry(async () => this.db.query(chainSyncParticipationAvgPercentQuery(epoch)).toPromise());
    return <SyncCommitteeParticipationAvgPercents>ret[0];
  }

  /**
   * Send query to Clickhouse and receives information about Operator Sync Committee participants
   */
  public async getOperatorSyncParticipationAvgPercents(epoch: bigint): Promise<NOsValidatorsSyncAvgPercent[]> {
    const ret = await this.retry(async () => this.db.query(operatorsSyncParticipationAvgPercentsQuery(epoch)).toPromise());
    return <NOsValidatorsSyncAvgPercent[]>ret;
  }

  public async getValidatorsCountWithGoodSyncParticipationLastNEpoch(
    slot: bigint,
    epochInterval: number,
    chainAvg: number,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsSyncByConditionCount[]> {
    const ret = await this.retry(async () =>
      this.db
        .query(
          validatorsCountWithSyncParticipationByConditionLastNEpochQuery(
            slot,
            epochInterval,
            validatorIndexes,
            `sync_percent >= (${chainAvg} - ${this.config.get('SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG')})`,
          ),
        )
        .toPromise(),
    );
    return <NOsValidatorsSyncByConditionCount[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have Sync Committee participation less when chain average last N epoch
   */
  public async getValidatorsCountWithBadSyncParticipationLastNEpoch(
    slot: bigint,
    epochInterval: number,
    chainAvg: number,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsSyncByConditionCount[]> {
    const ret = await this.retry(async () =>
      this.db
        .query(
          validatorsCountWithSyncParticipationByConditionLastNEpochQuery(
            slot,
            epochInterval,
            validatorIndexes,
            `sync_percent < (${chainAvg} - ${this.config.get('SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG')})`,
          ),
        )
        .toPromise(),
    );
    return <NOsValidatorsSyncByConditionCount[]>ret;
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
    const ret = await this.retry(async () =>
      this.db.query(validatorCountByConditionAttestationLastNEpochQuery(epoch, epochInterval, validatorIndexes, condition)).toPromise(),
    );
    return <NOsValidatorsByConditionAttestationCount[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have high avg inc. delay (>2) last N epoch
   */
  public async getValidatorCountHighAvgIncDelayAttestationOfNEpochQuery(
    epoch: bigint,
  ): Promise<NOsValidatorsByConditionAttestationCount[]> {
    const ret = await this.retry(async () =>
      this.db.query(validatorCountHighAvgIncDelayAttestationOfNEpochQuery(epoch, this.config.get('BAD_ATTESTATION_EPOCHS'))).toPromise(),
    );
    return <NOsValidatorsByConditionAttestationCount[]>ret;
  }

  public async getValidatorsCountWithGoodProposes(
    epoch: bigint,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsByConditionProposeCount[]> {
    const ret = await this.retry(async () =>
      this.db.query(validatorsCountByConditionMissProposeQuery(epoch, validatorIndexes, 'block_proposed = 1')).toPromise(),
    );
    return <NOsValidatorsByConditionProposeCount[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators miss proposes at our last processed epoch
   */
  public async getValidatorsCountWithMissedProposes(
    epoch: bigint,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsByConditionProposeCount[]> {
    const ret = await this.retry(async () =>
      this.db.query(validatorsCountByConditionMissProposeQuery(epoch, validatorIndexes, 'block_proposed = 0')).toPromise(),
    );
    return <NOsValidatorsByConditionProposeCount[]>ret;
  }

  public async getTotalBalance24hDifference(epoch: bigint): Promise<number | undefined> {
    const ret = await this.retry(async () => this.db.query(totalBalance24hDifferenceQuery(epoch)).toPromise());

    if (ret.length < 1) {
      return undefined;
    }

    const { curr_total_balance, prev_total_balance, total_diff } = <
      {
        curr_total_balance: number;
        prev_total_balance: number;
        total_diff: number;
      }
    >ret[0];

    if (!curr_total_balance || !prev_total_balance) {
      return undefined;
    }

    return total_diff;
  }

  public async getOperatorBalance24hDifference(epoch: bigint): Promise<{ nos_name: string; diff: number }[]> {
    const ret = await this.retry(async () => this.db.query(operatorBalance24hDifferenceQuery(epoch)).toPromise());
    return <{ nos_name: string; diff: number }[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have active, slashed, pending status
   */
  public async getUserNodeOperatorsStats(epoch: bigint): Promise<NOsValidatorsStatusStats[]> {
    const ret = await this.retry(async () => await this.db.query(userNodeOperatorsStatsQuery(epoch)).toPromise());
    return <NOsValidatorsStatusStats[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many User Node Operator validators have active, slashed, pending status
   */
  public async getUserValidatorsSummaryStats(epoch: bigint): Promise<ValidatorsStatusStats> {
    const ret = await this.retry(async () => await this.db.query(userValidatorsSummaryStatsQuery(epoch)).toPromise());
    return <ValidatorsStatusStats>ret[0];
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many other (not user) validators have active, slashed, pending status
   */
  public async getOtherValidatorsSummaryStats(epoch: bigint): Promise<ValidatorsStatusStats> {
    const ret = await this.retry(async () => await this.db.query(otherValidatorsSummaryStatsQuery(epoch)).toPromise());
    return <ValidatorsStatusStats>ret[0];
  }

  /**
   * Send query to Clickhouse and receives information about
   * User Node Operator proposes stats in the last N epochs
   */
  public async getUserNodeOperatorsProposesStats(epoch: bigint, epochInterval = 120): Promise<NOsProposesStats[]> {
    const ret = await this.retry(
      async () =>
        await this.db
          .query(userNodeOperatorsProposesStatsLastNEpochQuery(this.config.get('FETCH_INTERVAL_SLOTS'), epoch, epochInterval))
          .toPromise(),
    );
    return <NOsProposesStats[]>ret;
  }
}
