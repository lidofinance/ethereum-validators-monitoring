import { ClickHouse } from 'clickhouse';
import migration_000001_init from './migrations/migration_000001_init';
import migration_000002_validators from './migrations/migration_000002_validators';
import migration_000003_attestations from './migrations/migration_000003_attestations';
import migration_000004_proposes from './migrations/migration_000004_proposes';
import migration_000005_sync from './migrations/migration_000005_sync';
import {
  lidoNodeOperatorsProposesStatsLastNEpochQuery,
  lidoNodeOperatorsStatsQuery,
  lidoValidatorIDsQuery,
  lidoValidatorsSummaryStatsQuery,
  syncParticipationAvgPercentsQuery,
  totalBalance24hDifferenceQuery,
  validatorBalancesDeltaQuery,
  validatorCountWithMissAttestationLastNEpochQuery,
  validatorQuantile0001BalanceDeltasQuery,
  validatorsCountWithMissProposeQuery,
  validatorsCountWithNegativeDeltaQuery,
  validatorsCountWithSyncParticipationLessChainAvgLastNEpochQuery,
} from './clickhouse-storage.constants';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from '../common/config';
import { PrometheusService } from '../common/prometheus';
import { SyncCommitteeValidator } from '../ethereum/consensus/types/SyncCommitteeInfo';
import { AttesterDutyInfo } from '../ethereum/consensus/types/AttesterDutyInfo';
import { StateValidatorResponse } from '../ethereum/consensus/types/StateValidatorResponse';
import { ValStatus } from '../ethereum/consensus/types/ValidatorStatus';
import { retrier } from '../common/functions/retrier';
import { ProposerDutyInfo } from '../ethereum/consensus/types/ProposerDutyInfo';
import { KeysIndexed } from '../validators/registry';

type NodeOperatorDelta = { nos_name: string; delta: number };
type NodeOperatorNegativeDelta = { nos_name: string; neg_count: number };
type NodeOperatorValSyncParticipationLessChainAvg = {
  nos_name: string;
  less_chain_avg_count: number;
};
type NodeOperatorValMissAttestation = {
  nos_name: string;
  miss_attestation_count: number;
};
type NodeOperatorValMissPropose = {
  nos_name: string;
  miss_propose_count: number;
};
type SyncCommitteeParticipationAvgPercents = { lido: number; chain: number };
type NodeOperatorStats = {
  active_ongoing: number;
  pending: number;
  slashed: number;
};
type NamedNodeOperatorStats = { nos_name: string } & NodeOperatorStats;
type NodeOperatorProposesStats = { nos_name: string; all: number; missed: number };
export type ValidatorID = { validator_id: string; validator_pubkey: string };
export type CheckSyncCommitteeParticipationResult = {
  all_avg_participation: string;
  lido_validators: SyncCommitteeValidator[];
};
export type CheckAttestersDutyResult = {
  attestersDutyInfo: AttesterDutyInfo[];
  blocksAttestations: { [blockNum: string]: SlotAttestation[] };
  allMissedSlots: string[];
};
export type SlotAttestation = {
  bits: boolean[];
  slot: string;
  committee_index: string;
};
export type ValidatorCounts = {
  active: number;
  pending: number;
  slashed: number;
};

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
export class ClickhouseStorageService implements OnModuleInit {
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
    balances: StateValidatorResponse[],
    keysIndexed: KeysIndexed,
  ): Promise<ValidatorCounts> {
    return await this.prometheus.trackTask('write-balances', async () => {
      const otherCounts = {
        active: 0,
        pending: 0,
        slashed: 0,
      };
      let lidoCount = 0;
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
          if (keysIndexed.has(b.validator.pubkey)) {
            await ws.writeRow(
              `('${b.index || ''}', '${b.validator.pubkey || ''}', ${b.validator.slashed ? 1 : 0}, '${b.status}', ${b.balance}, ` +
                `${slot}, ${slotTime}, ${keysIndexed.get(b.validator.pubkey)?.operatorIndex ?? 'NULL'},
            '${keysIndexed.get(b.validator.pubkey)?.operatorName || 'NULL'}')`,
            );
            lidoCount++;
          } else {
            if (status.isActive(b)) otherCounts.active++;
            else if (status.isPending(b)) otherCounts.pending++;
            else if (status.isSlashed(b)) otherCounts.slashed++;
          }
        }
        await this.retry(async () => await ws.exec());
      }
      this.logger.log(`Wrote Lido ${lidoCount} balances to DB and counted others`);
      return otherCounts;
    });
  }

  public async writeAttestations(attDutyResult: CheckAttestersDutyResult, slotTime: bigint, keysIndexed: KeysIndexed): Promise<void> {
    return await this.prometheus.trackTask('write-attestations', async () => {
      while (attDutyResult.attestersDutyInfo.length > 0) {
        const chunk = attDutyResult.attestersDutyInfo.splice(0, this.chunkSize);
        const ws = this.db
          .insert(
            'INSERT INTO stats.validator_attestations ' +
              '(start_fetch_time, validator_pubkey, validator_id, committee_index, committee_length, committees_at_slot, ' +
              'validator_committee_index, slot_to_attestation, attested, info_from_block, nos_id, nos_name) VALUES',
          )
          .stream();
        for (const a of chunk) {
          a.attested = false;
          a.in_block = undefined;
          for (const [block, blockAttestations] of Object.entries(attDutyResult.blocksAttestations)) {
            if (BigInt(a.slot) >= BigInt(block)) continue; // Attestation cannot be included in the previous or current block
            const committeeAttestationInfo: any = blockAttestations.find(
              (att: any) => att.slot == a.slot && att.committee_index == a.committee_index,
            );
            if (committeeAttestationInfo) {
              a.attested = committeeAttestationInfo.bits[parseInt(a.validator_committee_index)];
              a.in_block = block;
            }
            if (a.attested) {
              // We found the nearest block includes validator attestation
              const missedSlotsOffset = attDutyResult.allMissedSlots.filter(
                (missed) => BigInt(missed) > BigInt(a.slot) && BigInt(missed) < BigInt(block),
              ).length;
              // If difference between attestation slot and
              // nearest block included attestation (not including missed slots) > ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY,
              // then we think it is bad attestation because validator will get the least reward
              if (
                BigInt(block) - BigInt(a.slot) - BigInt(missedSlotsOffset) >
                BigInt(this.config.get('ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY'))
              )
                a.attested = false;
              break;
            } // Else try to find attestation in next block
          }
          await ws.writeRow(
            `(${slotTime}, '${a.pubkey || ''}', '${a.validator_index || ''}', ${parseInt(a.committee_index)}, ` +
              `${parseInt(a.committee_length)}, ${parseInt(a.committees_at_slot)}, ${parseInt(a.validator_committee_index)}, ` +
              `${parseInt(a.slot)}, ${a.attested ? 1 : 0}, ${a.in_block ? parseInt(a.in_block) : 'NULL'}, ` +
              `${keysIndexed.get(a.pubkey)?.operatorIndex ?? 'NULL'}, '${keysIndexed.get(a.pubkey)?.operatorName || 'NULL'}')`,
          );
        }
        await this.retry(async () => await ws.exec());
      }
    });
  }

  public async writeProposes(proposesDutiesResult: ProposerDutyInfo[], slotTime: bigint, keysIndexed: KeysIndexed): Promise<void> {
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
    syncResult: CheckSyncCommitteeParticipationResult,
    slotTime: bigint,
    keysIndexed: KeysIndexed,
    lidoIDs: ValidatorID[],
    epoch: bigint,
  ): Promise<void> {
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
      for (const p of syncResult.lido_validators) {
        const pubKey = lidoIDs.find((v) => v.validator_id === p.validator_index)?.validator_pubkey || '';
        await ws.writeRow(
          `(${slotTime}, '${pubKey}', '${p.validator_index || ''}', ${last_slot_of_epoch}, ${p.epoch_participation_percent}, ` +
            `${syncResult.all_avg_participation},
          ${keysIndexed.get(pubKey)?.operatorIndex ?? 'NULL'}, '${keysIndexed.get(pubKey)?.operatorName || 'NULL'}')`,
        );
      }
      await this.retry(async () => await ws.exec());
    });
  }

  public async migrate(): Promise<void> {
    this.logger.log('Running migrations');
    await this.db.query(migration_000001_init).toPromise();
    await this.db.query(migration_000002_validators).toPromise();
    await this.db.query(migration_000003_attestations).toPromise();
    await this.db.query(migration_000004_proposes).toPromise();
    await this.db.query(migration_000005_sync).toPromise();
  }

  public async getValidatorBalancesDelta(slot: bigint): Promise<NodeOperatorDelta[]> {
    const ret = await this.retry(
      async () => await this.db.query(validatorBalancesDeltaQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString())).toPromise(),
    );
    return <NodeOperatorDelta[]>ret;
  }

  public async getValidatorQuantile0001BalanceDeltas(slot: bigint): Promise<NodeOperatorDelta[]> {
    const ret = await this.retry(async () =>
      this.db.query(validatorQuantile0001BalanceDeltasQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString())).toPromise(),
    );
    return <NodeOperatorDelta[]>ret;
  }

  public async getValidatorsCountWithNegativeDelta(slot: bigint): Promise<NodeOperatorNegativeDelta[]> {
    const ret = await this.retry(async () =>
      this.db.query(validatorsCountWithNegativeDeltaQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString())).toPromise(),
    );
    return <NodeOperatorNegativeDelta[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many Lido Node Operator validators have Sync Committee participation less when chain average last N epoch
   */
  public async getValidatorsCountWithSyncParticipationLessChainAvgLastNEpoch(
    slot: bigint,
    epochInterval: number,
    validatorIndexes: string[] = [],
  ): Promise<NodeOperatorValSyncParticipationLessChainAvg[]> {
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
    return <NodeOperatorValSyncParticipationLessChainAvg[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many Lido Node Operator validators missed attestation last N epoch
   */
  public async getValidatorCountWithMissedAttestationsLastNEpoch(
    slot: bigint,
    epochInterval: number,
    validatorIndexes: string[] = [],
  ): Promise<NodeOperatorValMissAttestation[]> {
    const ret = await this.retry(async () =>
      this.db
        .query(
          validatorCountWithMissAttestationLastNEpochQuery(
            this.config.get('FETCH_INTERVAL_SLOTS'),
            slot.toString(),
            epochInterval,
            validatorIndexes,
          ),
        )
        .toPromise(),
    );
    return <NodeOperatorValMissAttestation[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * how many Lido Node Operator validators miss proposes at our last processed epoch
   */
  public async getValidatorsCountWithMissedProposes(slot: bigint, validatorIndexes: string[] = []): Promise<NodeOperatorValMissPropose[]> {
    const ret = await this.retry(async () =>
      this.db
        .query(validatorsCountWithMissProposeQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString(), validatorIndexes))
        .toPromise(),
    );
    return <NodeOperatorValMissPropose[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about Sync Committee participants
   */
  public async getSyncParticipationAvgPercents(slot: bigint): Promise<SyncCommitteeParticipationAvgPercents> {
    const ret = await this.retry(async () => this.db.query(syncParticipationAvgPercentsQuery(slot)).toPromise());
    return <SyncCommitteeParticipationAvgPercents>ret[0];
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

  /**
   * Send query to Clickhouse and receives information about
   * how many Lido Node Operator validators have active, slashed, pending status
   */
  public async getLidoNodeOperatorsStats(slot: bigint): Promise<NamedNodeOperatorStats[]> {
    const ret = await this.retry(async () => await this.db.query(lidoNodeOperatorsStatsQuery(slot.toString())).toPromise());
    return <NamedNodeOperatorStats[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about summary
   * how many Lido Node Operator validators have active, slashed, pending status
   */
  public async getLidoValidatorsSummaryStats(slot: bigint): Promise<NodeOperatorStats> {
    const ret = await this.retry(async () => await this.db.query(lidoValidatorsSummaryStatsQuery(slot.toString())).toPromise());
    return <NodeOperatorStats>ret[0];
  }

  /**
   * Send query to Clickhouse and receives information about Lido validators (validator_id, pubkey)
   **/
  public async getLidoValidatorIDs(slot: bigint): Promise<ValidatorID[]> {
    const ret = await this.retry(async () => await this.db.query(lidoValidatorIDsQuery(slot.toString())).toPromise());
    return <ValidatorID[]>ret;
  }

  /**
   * Send query to Clickhouse and receives information about
   * Lido Node Operator proposes stats in the last N epochs
   */
  public async getLidoNodeOperatorsProposesStats(slot: bigint, epochInterval = 120): Promise<NodeOperatorProposesStats[]> {
    const ret = await this.retry(
      async () =>
        await this.db
          .query(lidoNodeOperatorsProposesStatsLastNEpochQuery(this.config.get('FETCH_INTERVAL_SLOTS'), slot.toString(), epochInterval))
          .toPromise(),
    );
    return <NodeOperatorProposesStats[]>ret;
  }
}
