import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService, ProposerDutyInfo, StateValidatorResponse, SyncCommitteeValidator } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';
import { RegistryService, RegistrySourceKeysIndexed } from 'common/validators-registry';
import { AttestationService } from 'duty/attestation';
import { ProposeService } from 'duty/propose';
import { StateService } from 'duty/state';
import { SyncService } from 'duty/sync';
import { CheckAttestersDutyResult, ClickhouseService, ValidatorIdentifications, ValidatorsStatusStats } from 'storage/clickhouse';

interface FetchFinalizedEpochDataResult {
  attestations: CheckAttestersDutyResult;
  proposeDutiesResult: ProposerDutyInfo[];
  syncResult: SyncCommitteeValidator[];
}

@Injectable()
export class DataProcessingService implements OnModuleInit {
  public latestSlotInDb = 0n;
  public firstSlotInDb = -1n;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly storage: ClickhouseService,
    protected readonly registryService: RegistryService,
    protected readonly state: StateService,
    protected readonly attestation: AttestationService,
    protected readonly propose: ProposeService,
    protected readonly sync: SyncService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.latestSlotInDb = await this.storage.getMaxSlot();
    this.firstSlotInDb = await this.storage.getMinSlot();
    this.prometheus.slotTime = await this.getSlotTime(this.latestSlotInDb);
    this.prometheus.slotNumber.set(Number(this.latestSlotInDb));
  }

  public async getSlotTime(slot: bigint): Promise<bigint> {
    return await this.clClient.getSlotTime(slot);
  }

  public async processAndWriteFinalizedData(
    slotToWrite: bigint,
    stateRoot: string,
    slotNumber: bigint,
  ): Promise<{ userIDs: ValidatorIdentifications[]; otherValidatorsCounts: ValidatorsStatusStats; otherAvgSyncPercent: number }> {
    return await this.prometheus.trackTask('process-write-finalized-data', async () => {
      try {
        if (slotToWrite <= this.latestSlotInDb) {
          this.logger.log(`Will not save slot [${slotToWrite}]. We already have that slot in db. Skipping...`);
          return;
        }
        const slotTime = await this.getSlotTime(slotToWrite);
        const epoch = slotToWrite / BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
        const keysIndexed = await this.registryService.getActualKeysIndexed(Number(slotTime));
        const fetcherWriter = this.fetcherWriter(slotToWrite, epoch, stateRoot, slotNumber, slotTime, keysIndexed);
        let otherValidatorsCounts: ValidatorsStatusStats;
        let otherAvgSyncPercent: number;
        // todo: optimize it
        let userIDs = await this.storage.getUserValidatorIDs(this.latestSlotInDb);
        if (this.latestSlotInDb == 0n || userIDs?.length == 0) {
          // First iteration or new validators fetched. We should fetch general validators info firstly (id)
          const slotRes = await fetcherWriter.fetchSlotData();
          otherValidatorsCounts = await fetcherWriter.writeSlotData(slotRes);
          userIDs = await this.storage.getUserValidatorIDs(slotToWrite);
          const epochRes = await fetcherWriter.fetchEpochData(userIDs);
          otherAvgSyncPercent = await fetcherWriter.writeEpochData(userIDs, epochRes);
        } else {
          const [slotRes, epochRes] = await Promise.all([fetcherWriter.fetchSlotData(), fetcherWriter.fetchEpochData(userIDs)]);
          [otherValidatorsCounts, otherAvgSyncPercent] = await Promise.all([
            fetcherWriter.writeSlotData(slotRes),
            fetcherWriter.writeEpochData(userIDs, epochRes),
          ]);
        }
        this.latestSlotInDb = slotToWrite;
        return { userIDs, otherValidatorsCounts, otherAvgSyncPercent };
      } catch (e) {
        this.logger.error('Error while fetching and writing new finalized slot or epoch info');
        this.logger.error(e as Error);
        throw e;
      }
    });
  }

  public async getPossibleHighRewardValidatorIndexes(valIDs: ValidatorIdentifications[], headEpoch: bigint): Promise<string[]> {
    return await this.prometheus.trackTask('high-reward-validators', async () => {
      this.logger.log('Start getting possible high reward validator indexes');
      const valIndexes: string[] = [];
      for (const i of valIDs) {
        valIndexes.push(i.validator_id);
      }
      const propDependentRoot = await this.clClient.getDutyDependentRoot(headEpoch);
      const [sync, prop] = await Promise.all([
        this.sync.getSyncCommitteeDutyInfo(valIndexes, headEpoch),
        this.propose.getProposerDutyInfo(valIndexes, propDependentRoot, headEpoch),
      ]);
      return [...new Set([...sync, ...prop].map((v) => v.validator_index))];
    });
  }

  protected fetcherWriter = (
    slot: bigint,
    epoch: bigint,
    stateRoot: string,
    slotNumber: bigint,
    slotTime: bigint,
    keysIndexed: RegistrySourceKeysIndexed,
  ) => {
    return {
      fetchSlotData: async () => {
        return await this.state.getValidatorsState(stateRoot);
      },
      writeSlotData: async (slotRes: StateValidatorResponse[]) => {
        const prepBalances = await this.state.prepStatesToWrite(slotRes, keysIndexed);
        this.logger.log(
          `Writing ${prepBalances.states.length} validators states for slot ${slot} (state root ${stateRoot} from slot ${slotNumber})`,
        );
        return await this.storage.writeStates(slot, slotTime, prepBalances, keysIndexed);
      },
      fetchEpochData: async (userIDs: ValidatorIdentifications[]) => {
        const userIndexes: string[] = [];
        for (const i of userIDs) {
          userIndexes.push(i.validator_id);
        }
        const [attesterDutyDependentRoot, proposerDutyDependentRoot] = await Promise.all(
          // for attester we should get root of previous epoch, for proposer - current
          [this.clClient.getDutyDependentRoot(epoch - 1n), this.clClient.getDutyDependentRoot(epoch)],
        );
        this.logger.log(`Attester Duty root: ${attesterDutyDependentRoot}`);
        this.logger.log(`Proposer Duty root: ${proposerDutyDependentRoot}`);
        const [attestations, proposeDutiesResult, syncResult] = await Promise.all([
          this.attestation.checkAttesterDuties(epoch, attesterDutyDependentRoot, userIndexes),
          this.propose.checkProposerDuties(epoch, proposerDutyDependentRoot, userIndexes),
          this.sync.checkSyncCommitteeDuties(epoch, stateRoot),
        ]);
        return { attestations, proposeDutiesResult, syncResult };
      },
      writeEpochData: async (userIDs: ValidatorIdentifications[], epochRes: FetchFinalizedEpochDataResult) => {
        this.logger.log(`Prepare attestations and sync committee result for writing`);
        const prepAttestations = await this.attestation.prepAttestationsToWrite(epochRes.attestations);
        const prepSyncs = this.sync.prepSyncCommitteeToWrite(userIDs, epochRes.syncResult);
        this.logger.log(`Writing ${epochRes.attestations.attestersDutyInfo.length} attestations result to DB for ${epoch} epoch`);
        await this.storage.writeAttestations(prepAttestations, slotTime, keysIndexed);
        this.logger.log(`Writing ${epochRes.proposeDutiesResult.length} proposes result to DB for ${epoch} epoch`);
        await this.storage.writeProposes(epochRes.proposeDutiesResult, slotTime, keysIndexed);
        this.logger.log(`Writing Sync Committee validators participation info to DB for ${epoch} epoch`);
        return await this.storage.writeSyncs(prepSyncs, slotTime, keysIndexed, userIDs, epoch);
      },
    };
  };
}
