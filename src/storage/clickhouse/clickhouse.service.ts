import { ClickHouse } from 'clickhouse';
import migration_000001_init from './migrations/migration_000001_init';
import migration_000002_validators from './migrations/migration_000002_validators';
import migration_000003_attestations from './migrations/migration_000003_attestations';
import migration_000004_proposes from './migrations/migration_000004_proposes';
import migration_000005_sync from './migrations/migration_000005_sync';
import migration_000006_attestations from './migrations/migration_000006_attestations';
import {
  userNodeOperatorsProposesStatsLastNEpochQuery,
  userNodeOperatorsStatsQuery,
  userValidatorIDsQuery,
  userValidatorsSummaryStatsQuery,
  totalBalance24hDifferenceQuery,
  validatorBalancesDeltaQuery,
  validatorCountByConditionAttestationLastNEpochQuery,
  validatorQuantile0001BalanceDeltasQuery,
  validatorsCountWithMissProposeQuery,
  validatorsCountWithNegativeDeltaQuery,
  validatorsCountWithSyncParticipationLessChainAvgLastNEpochQuery,
  userSyncParticipationAvgPercentQuery,
  operatorsSyncParticipationAvgPercentsQuery,
  operatorBalance24hDifferenceQuery,
  validatorCountHighAvgIncDelayAttestationOfNEpochQuery,
} from './clickhouse.constants';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';
import { retrier } from 'common/functions/retrier';
import { ProposerDutyInfo, StateValidatorResponse, ValStatus } from 'common/eth-providers';
import {
  CheckAttestersDutyResult,
  NOsValidatorsStatusStats,
  NOsDelta,
  NOsValidatorsNegDeltaCount,
  NOsProposesStats,
  ValidatorsStatusStats,
  NOsValidatorsMissProposeCount,
  NOsValidatorsSyncLessChainAvgCount,
  SyncCommitteeParticipationAvgPercents,
  ValidatorIdentifications,
  NOsValidatorsSyncAvgPercent,
  NOsValidatorsByConditionAttestationCount,
} from './clickhouse.types';
import { RegistrySourceKeysIndexed } from 'common/validators-registry/registry-source.interface';
import { FetchFinalizedSlotDataResult, SyncCommitteeValidatorPrepResult } from '../../inspector';

export const status = {
  isActive(val: StateValidatorResponse): boolean {
    return val.status == ValStatus.ActiveOngoing;
  },
  isPending(val: StateValidatorResponse): boolean {
    return [ValStatus.PendingQueued, ValStatus.PendingInitialized].includes(val.status);
  },
  isSlashed(val: StateValidatorResponse): boolean {
    return [ValStatus.ActiveSlashed, ValStatus.ExitedSlashed].includes(val.status) || val.validator.slashed;
  },
};

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

  public async close(): Promise<void> {
    this.logger.log(`Closing DB connection`);
  }

  public async getMaxSlot(): Promise<bigint> {
    const data: any = await this.retry(
      async () => await this.db.query('SELECT max(slot) as max FROM stats.validator_balances').toPromise(),
    );
    const slot = BigInt(parseInt(data[0].max, 10) || 0);

    this.logger.log(`Max (latest) stored slot in DB [${slot}]`);

    return slot;
  }

  public async getMinSlot(): Promise<bigint> {
    const data: any = await this.retry(
      async () => await this.db.query('SELECT min(slot) as min FROM stats.validator_balances').toPromise(),
    );
    const slot = BigInt(parseInt(data[0].min, 10) || 0);

    this.logger.log(`Min (first) stored slot in DB [${slot}]`);

    return slot;
  }

  public async writeBalances(
    slot: bigint,
    slotTime: bigint,
    slotRes: FetchFinalizedSlotDataResult,
    keysIndexed: RegistrySourceKeysIndexed,
  ): Promise<ValidatorsStatusStats> {
    return await this.prometheus.trackTask('write-balances', async () => {
      const balances = [...slotRes.balances];
      while (balances.length > 0) {
        const chunk = balances.splice(0, this.chunkSize);
        const ws = this.db
          .insert(
            'INSERT INTO stats.validator_balances ' +
              '(validator_id, validator_pubkey, validator_slashed, status, balance, slot, slot_time, nos_id, nos_name) VALUES',
          )
          // todo: make migration for rename nos_id -> operatorIndex, nos_name -> operatorName
          .stream();
        for (const b of chunk) {
          await ws.writeRow(
            `('${b.index || ''}', '${b.validator.pubkey || ''}', ${b.validator.slashed ? 1 : 0}, '${b.status}', ${b.balance}, ` +
              `${slot}, ${slotTime}, ${keysIndexed.get(b.validator.pubkey)?.operatorIndex ?? 'NULL'},
            '${keysIndexed.get(b.validator.pubkey)?.operatorName || 'NULL'}')`,
          );
        }
        await this.retry(async () => await ws.exec());
      }
      return slotRes.otherCounts;
    });
  }

  public async writeAttestations(
    attDutyResult: CheckAttestersDutyResult,
    slotTime: bigint,
    keysIndexed: RegistrySourceKeysIndexed,
  ): Promise<void> {
    return await this.prometheus.trackTask('write-attestations', async () => {
      const attestersDutyInfo = [...attDutyResult.attestersDutyInfo];
      while (attestersDutyInfo.length > 0) {
        const chunk = attestersDutyInfo.splice(0, this.chunkSize);
        const ws = this.db
          .insert(
            'INSERT INTO stats.validator_attestations ' +
              '(start_fetch_time, validator_pubkey, validator_id, committee_index, committee_length, committees_at_slot, ' +
              'validator_committee_index, slot_to_attestation, attested, inclusion_delay, valid_head, valid_target, ' +
              'valid_source, info_from_block, nos_id, nos_name) VALUES',
          )
          .stream();
        for (const a of chunk) {
          // todo: insert without undefined values for using default column values
          await ws.writeRow(
            `(${slotTime}, '${a.pubkey || ''}', '${a.validator_index || ''}', ${parseInt(a.committee_index)}, ` +
              `${parseInt(a.committee_length)}, ${parseInt(a.committees_at_slot)}, ${parseInt(a.validator_committee_index)}, ` +
              `${parseInt(a.slot)}, ${a.attested}, ${a.inclusion_delay ?? 'NULL'}, ${a.valid_head ?? 'NULL'}, ` +
              `${a.valid_target ?? 'NULL'}, ${a.valid_source ?? 'NULL'}, ${a.in_block ? parseInt(a.in_block) : 'NULL'}, ` +
              `${keysIndexed.get(a.pubkey)?.operatorIndex ?? 'NULL'}, '${keysIndexed.get(a.pubkey)?.operatorName || 'NULL'}')`,
          );
        }
        await this.retry(async () => await ws.exec());
      }
    });
  }

  public async writeProposes(
    proposesDutiesResult: ProposerDutyInfo[],
    slotTime: bigint,
    keysIndexed: RegistrySourceKeysIndexed,
  ): Promise<void> {
    return await this.prometheus.trackTask('write-proposes', async () => {
      const ws = this.db
        .insert(
          'INSERT INTO stats.validator_proposes ' +
            '(start_fetch_time, validator_pubkey, validator_id, slot_to_propose, proposed, nos_id, nos_name) VALUES',
        )
        .stream();
      for (const p of proposesDutiesResult) {
        await ws.writeRow(
          `(${slotTime}, '${p.pubkey || ''}', '${p.validator_index || ''}', ${parseInt(p.slot)}, ${p.proposed}, ` +
            `${keysIndexed.get(p.pubkey)?.operatorIndex ?? 'NULL'}, '${keysIndexed.get(p.pubkey)?.operatorName || 'NULL'}')`,
        );
      }
      await this.retry(async () => await ws.exec());
    });
  }

  public async writeSyncs(
    syncPrepResult: SyncCommitteeValidatorPrepResult,
    slotTime: bigint,
    keysIndexed: RegistrySourceKeysIndexed,
    userIDs: ValidatorIdentifications[],
    epoch: bigint,
  ): Promise<number> {
    return await this.prometheus.trackTask('write-syncs', async () => {
      const ws = this.db
        .insert(
          'INSERT INTO stats.validator_sync ' +
            '(start_fetch_time, validator_pubkey, validator_id, last_slot_of_epoch, epoch_participation_percent, ' +
            'epoch_chain_participation_percent_avg, nos_id, nos_name) VALUES',
        )
        .stream();
      const last_slot_of_epoch =
        epoch * BigInt(this.config.get('FETCH_INTERVAL_SLOTS')) + BigInt(this.config.get('FETCH_INTERVAL_SLOTS')) - 1n;
      for (const p of syncPrepResult.syncResult) {
        const pubKey = userIDs.find((v) => v.validator_id === p.validator_index)?.validator_pubkey || '';
        await ws.writeRow(
          `(${slotTime}, '${pubKey}', '${p.validator_index || ''}', ${last_slot_of_epoch}, ${p.epoch_participation_percent}, ` +
            `${p.other_avg}, ${keysIndexed.get(pubKey)?.operatorIndex ?? 'NULL'}, '${keysIndexed.get(pubKey)?.operatorName || 'NULL'}')`,
        );
      }
      await this.retry(async () => await ws.exec());
      return syncPrepResult.notUserAvgPercent;
    });
  }

  public async migrate(): Promise<void> {
    this.logger.log('Running migrations');
    await this.db.query(migration_000001_init).toPromise();
    await this.db.query(migration_000002_validators).toPromise();
    await this.db.query(migration_000003_attestations).toPromise();
    await this.db.query(migration_000004_proposes).toPromise();
    await this.db.query(migration_000005_sync).toPromise();
    await this.db.query(migration_000006_attestations).toPromise();
  }

  public async getValidatorBalancesDelta(slot: bigint): Promise<NOsDelta[]> {
    const ret = await this.retry(
      async () => await this.db.query(validatorBalancesDeltaQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString())).toPromise(),
    );
    return <NOsDelta[]>ret;
  }

  public async getValidatorQuantile0001BalanceDeltas(slot: bigint): Promise<NOsDelta[]> {
    const ret = await this.retry(async () =>
      this.db.query(validatorQuantile0001BalanceDeltasQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString())).toPromise(),
    );
    return <NOsDelta[]>ret;
  }

  public async getValidatorsCountWithNegativeDelta(slot: bigint): Promise<NOsValidatorsNegDeltaCount[]> {
    const ret = await this.retry(async () =>
      this.db.query(validatorsCountWithNegativeDeltaQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString())).toPromise(),
    );
    return <NOsValidatorsNegDeltaCount[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about User Sync Committee participants
   */
  public async getUserSyncParticipationAvgPercent(slot: bigint): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.retry(async () => this.db.query(userSyncParticipationAvgPercentQuery(slot)).toPromise());
    return <SyncCommitteeParticipationAvgPercents>ret[0];
  }

  /**
   * Send query to Clickhouse and receives information about Operator Sync Committee participants
   */
  public async getOperatorSyncParticipationAvgPercents(slot: bigint): Promise<NOsValidatorsSyncAvgPercent[]> {
    const ret = await this.retry(async () => this.db.query(operatorsSyncParticipationAvgPercentsQuery(slot)).toPromise());
    return <NOsValidatorsSyncAvgPercent[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have Sync Committee participation less when chain average last N epoch
   */
  public async getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
    slot: bigint,
    epochInterval: number,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsSyncLessChainAvgCount[]> {
    const ret = await this.retry(async () =>
      this.db
        .query(
          validatorsCountWithSyncParticipationLessChainAvgLastNEpochQuery(
            slot,
            this.config.get('FETCH_INTERVAL_SLOTS'),
            epochInterval,
            this.config.get('SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG'),
            validatorIndexes,
          ),
        )
        .toPromise(),
    );
    return <NOsValidatorsSyncLessChainAvgCount[]>ret;
  }

  public async getValidatorCountWithMissedAttestationsLastEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(slot, 1, 'attested = 0');
  }

  public async getValidatorCountWithHighIncDelayAttestationsLastEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(slot, 1, 'inclusion_delay > 1');
  }

  public async getValidatorCountWithInvalidHeadAttestationsLastEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(slot, 1, 'valid_head = 0');
  }

  public async getValidatorCountWithInvalidTargetAttestationsLastEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(slot, 1, 'valid_target = 0');
  }

  public async getValidatorCountWithInvalidSourceAttestationsLastEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(slot, 1, 'valid_source = 0');
  }

  public async getValidatorCountWithMissedAttestationsLastNEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(slot, this.config.get('BAD_ATTESTATION_EPOCHS'), 'attested = 0');
  }

  public async getValidatorCountWithHighRewardMissedAttestationsLastNEpoch(slot: bigint, possibleHighRewardValidators: string[]) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'attested = 0',
      possibleHighRewardValidators,
    );
  }

  public async getValidatorCountWithHighIncDelayAttestationsLastNEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'inclusion_delay > 1',
    );
  }

  public async getValidatorCountWithInvalidHeadAttestationsLastNEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(slot, this.config.get('BAD_ATTESTATION_EPOCHS'), 'valid_head = 0');
  }

  public async getValidatorCountWithInvalidTargetAttestationsLastNEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'valid_target = 0',
    );
  }

  public async getValidatorCountWithInvalidSourceAttestationsLastNEpoch(slot: bigint) {
    return await this.getValidatorCountByConditionAttestationsLastNEpoch(
      slot,
      this.config.get('BAD_ATTESTATION_EPOCHS'),
      'valid_source = 0',
    );
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators match condition
   */
  private async getValidatorCountByConditionAttestationsLastNEpoch(
    slot: bigint,
    epochInterval: number,
    condition: string,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsByConditionAttestationCount[]> {
    const ret = await this.retry(async () =>
      this.db
        .query(
          validatorCountByConditionAttestationLastNEpochQuery(
            this.config.get('FETCH_INTERVAL_SLOTS'),
            slot.toString(),
            epochInterval,
            validatorIndexes,
            condition,
          ),
        )
        .toPromise(),
    );
    return <NOsValidatorsByConditionAttestationCount[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have high avg inc. delay (>2) last N epoch
   */
  public async getValidatorCountHighAvgIncDelayAttestationOfNEpochQuery(slot: bigint): Promise<NOsValidatorsByConditionAttestationCount[]> {
    const ret = await this.retry(async () =>
      this.db
        .query(
          validatorCountHighAvgIncDelayAttestationOfNEpochQuery(
            this.config.get('FETCH_INTERVAL_SLOTS'),
            slot.toString(),
            this.config.get('BAD_ATTESTATION_EPOCHS'),
          ),
        )
        .toPromise(),
    );
    return <NOsValidatorsByConditionAttestationCount[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators miss proposes at our last processed epoch
   */
  public async getValidatorsCountWithMissedProposes(
    slot: bigint,
    validatorIndexes: string[] = [],
  ): Promise<NOsValidatorsMissProposeCount[]> {
    const ret = await this.retry(async () =>
      this.db
        .query(validatorsCountWithMissProposeQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString(), validatorIndexes))
        .toPromise(),
    );
    return <NOsValidatorsMissProposeCount[]>ret;
  }

  public async getTotalBalance24hDifference(slot: bigint): Promise<number | undefined> {
    const ret = await this.retry(async () => this.db.query(totalBalance24hDifferenceQuery(slot.toString())).toPromise());

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

  public async getOperatorBalance24hDifference(slot: bigint): Promise<{ nos_name: string; diff: number }[]> {
    const ret = await this.retry(async () => this.db.query(operatorBalance24hDifferenceQuery(slot.toString())).toPromise());
    return <{ nos_name: string; diff: number }[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many User Node Operator validators have active, slashed, pending status
   */
  public async getUserNodeOperatorsStats(slot: bigint): Promise<NOsValidatorsStatusStats[]> {
    const ret = await this.retry(async () => await this.db.query(userNodeOperatorsStatsQuery(slot.toString())).toPromise());
    return <NOsValidatorsStatusStats[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many User Node Operator validators have active, slashed, pending status
   */
  public async getUserValidatorsSummaryStats(slot: bigint): Promise<ValidatorsStatusStats> {
    const ret = await this.retry(async () => await this.db.query(userValidatorsSummaryStatsQuery(slot.toString())).toPromise());
    return <ValidatorsStatusStats>ret[0];
  }

  /**
   * Send query to Clickhouse and receives information about User validators (validator_id, pubkey)
   **/
  public async getUserValidatorIDs(slot: bigint): Promise<ValidatorIdentifications[]> {
    const ret = await this.retry(async () => await this.db.query(userValidatorIDsQuery(slot.toString())).toPromise());
    return <ValidatorIdentifications[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * User Node Operator proposes stats in the last N epochs
   */
  public async getUserNodeOperatorsProposesStats(slot: bigint, epochInterval = 120): Promise<NOsProposesStats[]> {
    const ret = await this.retry(
      async () =>
        await this.db
          .query(userNodeOperatorsProposesStatsLastNEpochQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString(), epochInterval))
          .toPromise(),
    );
    return <NOsProposesStats[]>ret;
  }
}
