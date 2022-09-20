import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { groupBy } from 'lodash';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';
import {
  AttesterDutyInfo,
  BeaconBlockAttestation,
  ConsensusProviderService,
  ProposerDutyInfo,
  ShortBeaconBlockInfo,
  StateValidatorResponse,
  SyncCommitteeDutyInfo,
  SyncCommitteeValidator,
} from 'common/eth-providers';
import { bigintRange } from 'common/functions/range';
import { RegistryService } from 'common/validators-registry';
import {
  CheckAttestersDutyResult,
  ClickhouseService,
  SlotAttestation,
  ValidatorIdentifications,
  ValidatorsStatusStats,
} from 'storage/clickhouse';
import { RegistrySourceKeysIndexed } from 'common/validators-registry/registry-source.interface';

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
  ) {}

  public async onModuleInit(): Promise<void> {
    this.latestSlotInDb = await this.storage.getMaxSlot();
    this.firstSlotInDb = await this.storage.getMinSlot();
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
        this.getSyncCommitteeDutyInfo(valIndexes, headEpoch),
        this.getProposerDutyInfo(valIndexes, propDependentRoot, headEpoch),
      ]);
      return [...new Set([...sync, ...prop].map((v) => v.validator_index))];
    });
  }

  protected async getSyncCommitteeDutyInfo(valIndexes: string[], epoch: bigint): Promise<SyncCommitteeDutyInfo[]> {
    return await this.clClient.getSyncCommitteeDuties(epoch, valIndexes);
  }

  protected async getProposerDutyInfo(valIndexes: string[], dependentRoot: string, epoch: bigint): Promise<ProposerDutyInfo[]> {
    const proposersDutyInfo = await this.clClient.getCanonicalProposerDuties(epoch, dependentRoot);
    return proposersDutyInfo.filter((p) => valIndexes.includes(p.validator_index));
  }

  protected async getAttestersDutyInfo(valIndexes: string[], dependentRoot: string, epoch: bigint): Promise<AttesterDutyInfo[]> {
    return await this.clClient.getChunkedAttesterDuties(epoch, dependentRoot, valIndexes);
  }

  protected async getSyncCommitteeIndexedValidators(epoch: bigint, stateRoot: string): Promise<SyncCommitteeValidator[]> {
    const syncCommitteeInfo = await this.clClient.getSyncCommitteeInfo(stateRoot, epoch);
    return syncCommitteeInfo.validators.map((v, i) => {
      return {
        in_committee_index: i,
        validator_index: v,
        epoch_participation_percent: 0,
      };
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
        this.logger.log('Start getting all validators balances');
        return await this.clClient.getBalances(stateRoot);
      },
      writeSlotData: async (slotRes: StateValidatorResponse[]) => {
        this.logger.log(`Start validators balance processing for slot ${slot} (state root ${stateRoot} from slot ${slotNumber})`);
        return await this.storage.writeBalances(slot, slotTime, slotRes, keysIndexed);
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
          this.checkAttesterDuties(epoch, attesterDutyDependentRoot, userIndexes),
          this.checkProposerDuties(epoch, proposerDutyDependentRoot, userIndexes),
          this.checkSyncCommitteeDuties(epoch, stateRoot),
        ]);
        return { attestations, proposeDutiesResult, syncResult };
      },
      writeEpochData: async (userIDs: ValidatorIdentifications[], epochRes: FetchFinalizedEpochDataResult) => {
        this.logger.log(`Writing ${epochRes.attestations.attestersDutyInfo.length} attestations result to DB for ${epoch} epoch`);
        await this.storage.writeAttestations(epochRes.attestations, slotTime, keysIndexed);
        this.logger.log(`Writing ${epochRes.proposeDutiesResult.length} proposes result to DB for ${epoch} epoch`);
        await this.storage.writeProposes(epochRes.proposeDutiesResult, slotTime, keysIndexed);
        this.logger.log(`Writing Sync Committee validators participation info to DB for ${epoch} epoch`);
        return await this.storage.writeSyncs(epochRes.syncResult, slotTime, keysIndexed, userIDs, epoch);
      },
    };
  };

  /**
   * Check Attesters duties: get duties info by our validators keys and do bitwise attestations check
   **/
  protected async checkAttesterDuties(epoch: bigint, dutyDependentRoot: string, userIndexes: string[]): Promise<CheckAttestersDutyResult> {
    return await this.prometheus.trackTask('check-attester-duties', async () => {
      this.logger.log(`Start getting attesters duties info`);
      const attestersDutyInfo: AttesterDutyInfo[] = await this.getAttestersDutyInfo(userIndexes, dutyDependentRoot, epoch);
      this.logger.log(`Start processing attesters duties info`);
      const blocksAttestations: { [block: string]: SlotAttestation[] } = {};
      let allMissedSlots: string[] = [];
      let lastBlockInfo: ShortBeaconBlockInfo | void;
      let lastMissedSlots: string[];
      // Check all slots from epoch start to last epoch slot + ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY
      const firstSlotInEpoch = epoch * 32n;
      const slotsToCheck: bigint[] = bigintRange(
        firstSlotInEpoch,
        firstSlotInEpoch + 32n + BigInt(this.config.get('ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY')),
      );
      for (const slotToCheck of slotsToCheck) {
        if (lastBlockInfo && lastBlockInfo.message.slot > slotToCheck.toString()) {
          continue; // If we have lastBlockInfo > slotToCheck it means we have already processed this
        }
        [lastBlockInfo, lastMissedSlots] = await this.clClient.getBlockInfoWithSlotAttestations(slotToCheck);
        allMissedSlots = allMissedSlots.concat(lastMissedSlots);
        if (!lastBlockInfo) {
          continue; // Failed to get info about the nearest existing block
        }
        // A committee attestation can be included in a block as multiple parts.
        // It is necessary to group such attestations
        const groupedAttestations = groupBy(lastBlockInfo.message.body.attestations, (att: BeaconBlockAttestation) =>
          [att.data.slot, att.data.index].join('_'),
        );
        blocksAttestations[lastBlockInfo.message.slot.toString()] = Object.values(groupedAttestations).map(
          (group: BeaconBlockAttestation[]) => {
            // Need to perform a bitwise OR to get the full information about the committee attestation
            const bytesArray = fromHexString(group[0].aggregation_bits);
            const CommitteeBits = new BitVectorType({
              length: bytesArray.length * 8,
            });
            const startBits = Array.from(CommitteeBits.deserialize(bytesArray));
            const aggregatedBits = group.reduce((bits, att) => {
              const currBits = Array.from(CommitteeBits.deserialize(fromHexString(att.aggregation_bits)));
              return bits.map((val: boolean, index: number) => val || currBits[index]);
            }, startBits);
            return {
              bits: aggregatedBits,
              slot: group[0].data.slot,
              committee_index: group[0].data.index,
            };
          },
        );
      }
      this.logger.log(`All missed slots in getting attestations info process: ${allMissedSlots}`);
      return { attestersDutyInfo, blocksAttestations, allMissedSlots };
    });
  }

  /**
   * Check Proposer duties and return user validators propose result
   **/
  protected async checkProposerDuties(epoch: bigint, dutyDependentRoot: string, valIndexes: string[]): Promise<ProposerDutyInfo[]> {
    return await this.prometheus.trackTask('check-proposer-duties', async () => {
      this.logger.log(`Start getting proposers duties info`);
      const userProposersDutyInfo = await this.getProposerDutyInfo(valIndexes, dutyDependentRoot, epoch);
      this.logger.log(`Processing proposers duties info`);
      for (const userProp of userProposersDutyInfo) {
        userProp.proposed = false;
        const blockInfo: ShortBeaconBlockInfo = await this.clClient.getBlockInfo(userProp.slot);
        if (!blockInfo) continue; // it means that block is missed
        if (blockInfo.message.proposer_index == userProp.validator_index) userProp.proposed = true;
        else {
          throw Error(
            `Proposer duty info cannot be trusted. Make sure the node is synchronized!
          Expect block [${blockInfo.message.slot}] proposer - ${userProp.validator_index},
          but actual - ${blockInfo.message.proposer_index}`,
          );
        }
      }
      return userProposersDutyInfo;
    });
  }

  /**
   * Check Sync committee duties: get duties info by our validators keys and do bitwise check
   **/
  protected async checkSyncCommitteeDuties(epoch: bigint, stateRoot: string): Promise<SyncCommitteeValidator[]> {
    return await this.prometheus.trackTask('check-sync-duties', async () => {
      this.logger.log(`Start getting sync committee participation info`);
      const SyncCommitteeBits = new BitVectorType({ length: 512 }); // sync participants count in committee
      const indexedValidators = await this.getSyncCommitteeIndexedValidators(epoch, stateRoot);
      this.logger.log(`Processing sync committee participation info`);
      const epochBlocks: ShortBeaconBlockInfo[] = [];
      const missedSlots: bigint[] = [];
      const startSlot = epoch * BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
      for (let slot = startSlot; slot < startSlot + BigInt(this.config.get('FETCH_INTERVAL_SLOTS')); slot = slot + 1n) {
        const blockInfo: ShortBeaconBlockInfo = await this.clClient.getBlockInfo(slot);
        blockInfo ? epochBlocks.push(blockInfo) : missedSlots.push(slot);
      }
      this.logger.log(`All missed slots in getting sync committee info process: ${missedSlots}`);
      const epochBlocksBits = epochBlocks.map((block) =>
        Array.from(SyncCommitteeBits.deserialize(fromHexString(block.message.body.sync_aggregate.sync_committee_bits))),
      );
      for (const indexedValidator of indexedValidators) {
        let sync_count = 0;
        for (const bits of epochBlocksBits) {
          if (bits[indexedValidator.in_committee_index]) sync_count++;
        }
        indexedValidator.epoch_participation_percent = (sync_count / epochBlocksBits.length) * 100;
      }
      return indexedValidators;
    });
  }
}
