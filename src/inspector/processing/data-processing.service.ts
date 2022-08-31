import {
  CheckAttestersDutyResult,
  CheckSyncCommitteeParticipationResult,
  ClickhouseStorageService,
  SlotAttestation,
  ValidatorCounts,
  ValidatorID,
} from '../../storage/clickhouse-storage.service';
import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { groupBy } from 'lodash';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from '../../common/config';
import { PrometheusService } from '../../common/prometheus';
import { ConsensusClientService } from '../../ethereum/consensus/consensus-client.service';
import { ProposerDutyInfo } from '../../ethereum/consensus/types/ProposerDutyInfo';
import { SyncCommitteeDutyInfo } from '../../ethereum/consensus/types/SyncCommitteeDutyInfo';
import { AttesterDutyInfo } from '../../ethereum/consensus/types/AttesterDutyInfo';
import { SyncCommitteeValidator } from '../../ethereum/consensus/types/SyncCommitteeInfo';
import { StateValidatorResponse } from '../../ethereum/consensus/types/StateValidatorResponse';
import { BeaconBlockAttestation, ShortBeaconBlockInfo } from '../../ethereum/consensus/types/ShortBeaconBlockInfo';
import { bigintRange } from '../../common/functions/range';
import { KeysIndexed, RegistryService } from '../../validators/registry';

type FetchFinalizedEpochDataResult = {
  attestations: CheckAttestersDutyResult;
  proposeDutiesResult: ProposerDutyInfo[];
  syncResult: CheckSyncCommitteeParticipationResult;
};

@Injectable()
export class DataProcessingService implements OnModuleInit {
  public latestSlotInDb = 0n;
  public firstSlotInDb = -1n;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusClientService,
    protected readonly storage: ClickhouseStorageService,
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
  ): Promise<{ lidoIDs: ValidatorID[]; otherCounts: ValidatorCounts } | undefined> {
    return await this.prometheus.trackTask('process-write-finalized-data', async () => {
      try {
        if (slotToWrite <= this.latestSlotInDb) {
          this.logger.log(`Will not save slot [${slotToWrite}]. We already have that slot in db. Skipping...`);
          return;
        }
        const keysIndexed = await this.registryService.getAllKeysIndexed();
        const slotTime = await this.getSlotTime(slotToWrite);
        const epoch = slotToWrite / BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
        const fetcherWriter = this.fetcherWriter(slotToWrite, epoch, stateRoot, slotNumber, slotTime, keysIndexed);
        let otherCounts;
        // todo: optimize it
        let lidoIDs = await this.storage.getLidoValidatorIDs(this.latestSlotInDb);
        if (this.latestSlotInDb == 0n || lidoIDs?.length == 0 || keysIndexed.size != lidoIDs?.length) {
          // First iteration or new validators fetched. We should fetch general validators info firstly (id)
          const slotRes = await fetcherWriter.fetchSlotData();
          otherCounts = await fetcherWriter.writeSlotData(slotRes);
          lidoIDs = await this.storage.getLidoValidatorIDs(slotToWrite);
          const epochRes = await fetcherWriter.fetchEpochData(lidoIDs);
          await fetcherWriter.writeEpochData(lidoIDs, epochRes);
        } else {
          const [slotRes, epochRes] = await Promise.all([fetcherWriter.fetchSlotData(), fetcherWriter.fetchEpochData(lidoIDs)]);
          [otherCounts] = await Promise.all([fetcherWriter.writeSlotData(slotRes), fetcherWriter.writeEpochData(lidoIDs, epochRes)]);
        }
        this.latestSlotInDb = slotToWrite;
        return { lidoIDs, otherCounts };
      } catch (e) {
        this.logger.error('Error while fetching and writing new finalized slot or epoch info');
        this.logger.error(e as Error);
        throw e;
      }
    });
  }

  public async getPossibleHighRewardValidatorIndexes(valIDs: ValidatorID[], headEpoch: bigint): Promise<string[]> {
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

  protected async getSyncCommitteeIndexedValidators(
    epoch: bigint,
    stateRoot: string,
    lidoIndexes: string[],
  ): Promise<SyncCommitteeValidator[][]> {
    const syncCommitteeInfo = await this.clClient.getSyncCommitteeInfo(stateRoot, epoch);
    const lidoSyncCommitteeVals: SyncCommitteeValidator[] = [];
    const allSyncCommitteeVals: SyncCommitteeValidator[] = [];
    syncCommitteeInfo.validators.forEach((v, i) => {
      const indexed: SyncCommitteeValidator = {
        in_committee_index: i,
        validator_index: v,
        epoch_participation_percent: 0,
      };
      allSyncCommitteeVals.push(indexed);
      if (lidoIndexes.includes(v)) lidoSyncCommitteeVals.push(indexed);
    });
    return [lidoSyncCommitteeVals, allSyncCommitteeVals];
  }

  protected fetcherWriter = (
    slot: bigint,
    epoch: bigint,
    stateRoot: string,
    slotNumber: bigint,
    slotTime: bigint,
    keysIndexed: KeysIndexed,
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
      fetchEpochData: async (lidoIDs: ValidatorID[]) => {
        const lidoIndexes: string[] = [];
        for (const i of lidoIDs) {
          lidoIndexes.push(i.validator_id);
        }
        const [attesterDutyDependentRoot, proposerDutyDependentRoot] = await Promise.all(
          // for attester we should get root of previous epoch, for proposer - current
          [this.clClient.getDutyDependentRoot(epoch - 1n), this.clClient.getDutyDependentRoot(epoch)],
        );
        this.logger.log(`Attester Duty root: ${attesterDutyDependentRoot}`);
        this.logger.log(`Proposer Duty root: ${proposerDutyDependentRoot}`);
        const [attestations, proposeDutiesResult, syncResult] = await Promise.all([
          this.checkAttesterDuties(epoch, attesterDutyDependentRoot, lidoIndexes),
          this.checkProposerDuties(epoch, proposerDutyDependentRoot, lidoIndexes),
          this.checkSyncCommitteeDuties(epoch, stateRoot, lidoIndexes),
        ]);
        return { attestations, proposeDutiesResult, syncResult };
      },
      writeEpochData: async (lidoIDs: ValidatorID[], epochRes: FetchFinalizedEpochDataResult) => {
        this.logger.log(`Writing Lido ${epochRes.attestations.attestersDutyInfo.length} attestations result to DB for ${epoch} epoch`);
        await this.storage.writeAttestations(epochRes.attestations, slotTime, keysIndexed);
        this.logger.log(`Writing Lido ${epochRes.proposeDutiesResult.length} proposes result to DB for ${epoch} epoch`);
        await this.storage.writeProposes(epochRes.proposeDutiesResult, slotTime, keysIndexed);
        this.logger.log(
          `Writing Lido ${epochRes.syncResult.lido_validators.length} Sync Committee validators participation info to DB for ${epoch} epoch`,
        );
        await this.storage.writeSyncs(epochRes.syncResult, slotTime, keysIndexed, lidoIDs, epoch);
      },
    };
  };

  /**
   * Check Attesters duties: get duties info by our validators keys and do bitwise attestations check
   **/
  protected async checkAttesterDuties(epoch: bigint, dutyDependentRoot: string, lidoIndexes: string[]): Promise<CheckAttestersDutyResult> {
    return await this.prometheus.trackTask('check-attester-duties', async () => {
      this.logger.log(`Start getting Lido attesters duties info`);
      const attestersDutyInfo: AttesterDutyInfo[] = await this.getAttestersDutyInfo(lidoIndexes, dutyDependentRoot, epoch);
      this.logger.log(`Start processing Lido attesters duties info`);
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
   * Check Proposer duties and return Lido validators propose result
   **/
  protected async checkProposerDuties(epoch: bigint, dutyDependentRoot: string, valIndexes: string[]): Promise<ProposerDutyInfo[]> {
    return await this.prometheus.trackTask('check-proposer-duties', async () => {
      this.logger.log(`Start getting Lido proposers duties info`);
      const lidoProposersDutyInfo = await this.getProposerDutyInfo(valIndexes, dutyDependentRoot, epoch);
      this.logger.log(`Processing Lido proposers duties info`);
      for (const lidoProp of lidoProposersDutyInfo) {
        lidoProp.proposed = false;
        const blockInfo: ShortBeaconBlockInfo = await this.clClient.getBlockInfo(lidoProp.slot);
        if (!blockInfo) continue; // it means that block is missed
        if (blockInfo.message.proposer_index == lidoProp.validator_index) lidoProp.proposed = true;
        else {
          throw Error(
            `Proposer duty info cannot be trusted. Make sure the node is synchronized!
          Expect block [${blockInfo.message.slot}] proposer - ${lidoProp.validator_index},
          but actual - ${blockInfo.message.proposer_index}`,
          );
        }
      }
      return lidoProposersDutyInfo;
    });
  }

  /**
   * Check Sync committee duties: get duties info by our validators keys and do bitwise check
   **/
  protected async checkSyncCommitteeDuties(
    epoch: bigint,
    stateRoot: string,
    lidoIndexes: string[],
  ): Promise<CheckSyncCommitteeParticipationResult> {
    return await this.prometheus.trackTask('check-sync-duties', async () => {
      this.logger.log(`Start getting Lido sync committee participation info`);
      const SyncCommitteeBits = new BitVectorType({ length: 512 }); // sync participants count in committee
      const [lido, all] = await this.getSyncCommitteeIndexedValidators(epoch, stateRoot, lidoIndexes);
      this.logger.log(`Processing Lido sync committee participation info`);
      if (lido.length === 0) {
        return { all_avg_participation: '', lido_validators: [] };
      }
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
      for (const indexedValidator of all) {
        indexedValidator.epoch_participation_percent = (() => {
          let sync_count = 0;
          for (const bits of epochBlocksBits) {
            if (bits[indexedValidator.in_committee_index]) sync_count++;
          }
          return (sync_count / epochBlocksBits.length) * 100;
        })();
      }
      const allAvgParticipation = (all.reduce((a, b) => a + b.epoch_participation_percent, 0) / all.length).toFixed(2);
      const lidoValidators = all.filter((v) => lido.map((l) => l.validator_index).includes(v.validator_index));

      return {
        all_avg_participation: allAvgParticipation,
        lido_validators: lidoValidators,
      };
    });
  }
}
