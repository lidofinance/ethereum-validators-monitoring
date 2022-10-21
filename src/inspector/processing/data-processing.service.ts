import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';
import {
  AttesterDutyInfo,
  BeaconBlockAttestation,
  ConsensusProviderService,
  ProposerDutyInfo,
  BlockInfoResponse,
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
  status,
  ValidatorIdentifications,
  ValidatorsStatusStats,
} from 'storage/clickhouse';
import { RegistrySourceKeysIndexed } from 'common/validators-registry/registry-source.interface';

export interface FetchFinalizedSlotDataResult {
  balances: StateValidatorResponse[];
  otherCounts: ValidatorsStatusStats;
}

interface SyncCommitteeValidatorWithOtherAvg extends SyncCommitteeValidator {
  other_avg: number;
}

export interface SyncCommitteeValidatorPrepResult {
  syncResult: SyncCommitteeValidatorWithOtherAvg[];
  notUserAvgPercent: number;
}

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
        const prepBalances = await this.prepBalancesToWrite(slotRes, keysIndexed);
        this.logger.log(
          `Writing ${prepBalances.balances.length} validators balance for slot ${slot} (state root ${stateRoot} from slot ${slotNumber})`,
        );
        return await this.storage.writeBalances(slot, slotTime, prepBalances, keysIndexed);
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
        await this.storage.writeAttestations(await this.prepAttestationsToWrite(epochRes.attestations), slotTime, keysIndexed);
        this.logger.log(`Writing ${epochRes.proposeDutiesResult.length} proposes result to DB for ${epoch} epoch`);
        await this.storage.writeProposes(epochRes.proposeDutiesResult, slotTime, keysIndexed);
        this.logger.log(`Writing Sync Committee validators participation info to DB for ${epoch} epoch`);
        return await this.storage.writeSyncs(
          await this.prepSyncCommitteeToWrite(userIDs, epochRes.syncResult),
          slotTime,
          keysIndexed,
          userIDs,
          epoch,
        );
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
      let lastBlockInfo: BlockInfoResponse | void;
      let lastMissedSlots: string[];
      // Check all slots from epoch start to last epoch slot + 32 (max inclusion delay)
      const firstSlotInEpoch = epoch * 32n;
      const slotsToCheck: bigint[] = bigintRange(firstSlotInEpoch, firstSlotInEpoch + 32n + 32n);
      for (const slotToCheck of slotsToCheck) {
        if (lastBlockInfo && lastBlockInfo.message.slot > slotToCheck.toString()) {
          continue; // If we have lastBlockInfo > slotToCheck it means we have already processed this
        }
        [lastBlockInfo, lastMissedSlots] = await this.clClient.getBlockInfoWithSlotAttestations(slotToCheck);
        allMissedSlots = allMissedSlots.concat(lastMissedSlots);
        if (!lastBlockInfo) {
          continue; // Failed to get info about the nearest existing block
        }
        blocksAttestations[lastBlockInfo.message.slot.toString()] = lastBlockInfo.message.body.attestations.map(
          (att: BeaconBlockAttestation) => {
            const bytesArray = fromHexString(att.aggregation_bits);
            const CommitteeBits = new BitVectorType({
              length: bytesArray.length * 8,
            });
            return {
              bits: Array.from(CommitteeBits.deserialize(bytesArray)),
              head: att.data.beacon_block_root,
              target: att.data.target.root,
              source: att.data.source.root,
              slot: att.data.slot,
              committee_index: att.data.index,
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
        const blockInfo = await this.clClient.getBlockInfo(userProp.slot);
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
      const epochBlocks: BlockInfoResponse[] = [];
      const missedSlots: bigint[] = [];
      const startSlot = epoch * BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
      for (let slot = startSlot; slot < startSlot + BigInt(this.config.get('FETCH_INTERVAL_SLOTS')); slot = slot + 1n) {
        const blockInfo = await this.clClient.getBlockInfo(slot);
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

  protected async prepBalancesToWrite(
    balances: StateValidatorResponse[],
    keysIndexed: RegistrySourceKeysIndexed,
  ): Promise<FetchFinalizedSlotDataResult> {
    return await this.prometheus.trackTask('prep-balances', async () => {
      const otherCounts: ValidatorsStatusStats = {
        active_ongoing: 0,
        pending: 0,
        slashed: 0,
      };
      const filtered = balances.filter((b) => {
        if (keysIndexed.has(b.validator.pubkey)) {
          return true;
        } else {
          if (status.isActive(b)) otherCounts.active_ongoing++;
          else if (status.isPending(b)) otherCounts.pending++;
          else if (status.isSlashed(b)) otherCounts.slashed++;
          return false;
        }
      });
      return { balances: filtered, otherCounts };
    });
  }

  savedCanonSlotsAttProperties = {};

  protected async getCanonSlotRoot(slot: bigint) {
    const cached = this.savedCanonSlotsAttProperties[String(slot)];
    if (cached) return cached;
    const root = (await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(slot))[0].root;
    this.savedCanonSlotsAttProperties[String(slot)] = root;
    return root;
  }

  protected async prepAttestationsToWrite(attDutyResult: CheckAttestersDutyResult) {
    this.savedCanonSlotsAttProperties = {};
    const blocksAttestation = Object.entries(attDutyResult.blocksAttestations).sort(
      (b1, b2) => parseInt(b1[0]) - parseInt(b2[0]), // Sort array by block number
    );
    for (const duty of attDutyResult.attestersDutyInfo) {
      duty.attested = false;
      duty.valid_head = undefined;
      duty.valid_target = undefined;
      duty.valid_source = undefined;
      duty.in_block = undefined;
      for (const [block, blockAttestations] of blocksAttestation.filter(
        ([b]) => BigInt(b) > BigInt(duty.slot), // Attestation cannot be included in the previous or current block
      )) {
        const committeeAttestations: SlotAttestation[] = blockAttestations.filter(
          (att: any) => att.slot == duty.slot && att.committee_index == duty.committee_index,
        );
        if (!committeeAttestations) continue;
        for (const ca of committeeAttestations) {
          duty.attested = ca.bits[parseInt(duty.validator_committee_index)];
          duty.in_block = block;
          if (!duty.attested) continue; // continue to find attestation with validator attestation
          // and if validator attests block - calculate inclusion delay and check properties (head, target, source)
          // calculate inclusion delay
          const missedSlotsOffset = attDutyResult.allMissedSlots.filter(
            (missed) => BigInt(missed) > BigInt(duty.slot) && BigInt(missed) < BigInt(block),
          ).length;
          duty.inclusion_delay = Number(BigInt(block) - BigInt(duty.slot)) - missedSlotsOffset;
          duty.valid_head = ca.head == (await this.getCanonSlotRoot(BigInt(ca.slot)));
          duty.valid_target = ca.target == (await this.getCanonSlotRoot((BigInt(ca.slot) / 32n) * 32n));
          duty.valid_source = ca.source == (await this.getCanonSlotRoot((BigInt(ca.slot) / 32n - 1n) * 32n));
          break;
        }
        if (duty.attested) break;
      }
    }
    return attDutyResult;
  }

  protected async prepSyncCommitteeToWrite(
    userIDs: ValidatorIdentifications[],
    syncResult: SyncCommitteeValidator[],
  ): Promise<SyncCommitteeValidatorPrepResult> {
    const notUserPercents = [];
    const userValidators = [];
    for (const p of syncResult) {
      const pubKey = userIDs.find((v) => v.validator_id === p.validator_index)?.validator_pubkey || '';
      if (pubKey) {
        const other = syncResult.filter((s) => s.validator_index != p.validator_index);
        userValidators.push({
          ...p,
          other_avg: other.reduce((a, b) => a + b.epoch_participation_percent, 0) / other.length,
        });
      } else {
        notUserPercents.push(p.epoch_participation_percent);
      }
    }

    const notUserAvgPercent = notUserPercents.length ? notUserPercents.reduce((a, b) => a + b, 0) / notUserPercents.length : undefined;
    return { syncResult: userValidators, notUserAvgPercent };
  }
}
