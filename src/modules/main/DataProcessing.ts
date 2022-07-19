import { inject, injectable, postConstruct }            from 'inversify';
import { ILogger }                                      from '../logger/ILogger';
import { Environment }                                  from '../environment/Environment';
import { Eth2Client }                                   from '../lighthouse/Eth2Client';
import { NodeOperatorsContract }                        from '../eth-rpc/NodeOperatorsContract';
import {
  CheckAttestersDutyResult,
  CheckSyncCommitteeParticipationResult,
  ClickhouseStorage,
  SlotAttestation,
  ValidatorCounts,
  ValidatorID
}                                                       from '../storage/ClickhouseStorage';
import { KeysIndexed }                                  from '../eth-rpc/KeysIndexed';
import { AttesterDutyInfo }                             from '../lighthouse/types/AttesterDutyInfo';
import { BitVectorType, fromHexString }                 from '@chainsafe/ssz';
import { BeaconBlockAttestation, ShortBeaconBlockInfo } from '../lighthouse/types/ShortBeaconBlockInfo';
import { groupBy }                                      from 'lodash';
import { ProposerDutyInfo }                             from '../lighthouse/types/ProposerDutyInfo';
import { SyncCommitteeDutyInfo }                        from '../lighthouse/types/SyncCommitteeDutyInfo';
import { SyncCommitteeValidator }                       from '../lighthouse/types/SyncCommitteeInfo';
import { bigintRange }                                  from '../common/utils/range';
import { StateValidatorResponse }                       from '../lighthouse/types/StateValidatorResponse';
import { Prometheus }                                   from '../prometheus/Prometheus';

type FetchFinalizedEpochDataResult = {
  attestations: CheckAttestersDutyResult;
  proposeDutiesResult: ProposerDutyInfo[];
  syncResult: CheckSyncCommitteeParticipationResult
}


@injectable()
export class DataProcessor {
  public latestSlotInDb = 0n;
  public firstSlotInDb = -1n;


  public constructor(
    @inject(ILogger) protected logger: ILogger,
    @inject(Environment) protected env: Environment,
    @inject(Prometheus) protected prometheus: Prometheus,
    @inject(Eth2Client) protected lighthouse: Eth2Client,
    @inject(ClickhouseStorage) protected storage: ClickhouseStorage,
    @inject(NodeOperatorsContract) protected nodeOperatorsContract: NodeOperatorsContract
  ) {
  }

  @postConstruct()
  public async initialize(): Promise<void> {
    this.latestSlotInDb = await this.storage.getMaxSlot();
    this.firstSlotInDb = await this.storage.getMinSlot();
  }

  public async getSlotTime(slot: bigint): Promise<bigint> {
    return await this.lighthouse.getSlotTime(slot);
  }

  public async processAndWriteFinalizedData(
    slotToWrite: bigint, stateRoot: string, slotNumber: bigint
  ): Promise<{ lidoIDs: ValidatorID[]; otherCounts: ValidatorCounts } | undefined> {
    return await this.prometheus.trackTask('process-write-finalized-data', async () => {
      try {
        if (slotToWrite <= this.latestSlotInDb) {
          this.logger.info(`Will not save slot [%d]. We already have that slot in db. Skipping...`, slotToWrite);
          return;
        }
        const keysIndexed = await this.nodeOperatorsContract.getAllKeysIndexed();
        const slotTime = await this.getSlotTime(slotToWrite);
        const epoch = slotToWrite / BigInt(this.env.FETCH_INTERVAL_SLOTS);
        const fetcherWriter = this.fetcherWriter(slotToWrite, epoch, stateRoot, slotNumber, slotTime, keysIndexed);
        let lidoIDs, otherCounts;
        if (this.latestSlotInDb == 0n) {
          // First iteration. We should fetch general validators info firstly
          const slotRes = await fetcherWriter.fetchSlotData();
          otherCounts = await fetcherWriter.writeSlotData(slotRes);
          lidoIDs = await this.storage.getLidoValidatorIDs(slotToWrite);
          const epochRes = await fetcherWriter.fetchEpochData(lidoIDs);
          await fetcherWriter.writeEpochData(lidoIDs, epochRes);
        } else {
          lidoIDs = await this.storage.getLidoValidatorIDs(this.latestSlotInDb);
          const [slotRes, epochRes] = await Promise.all(
            [fetcherWriter.fetchSlotData(), fetcherWriter.fetchEpochData(lidoIDs)]
          );
          [otherCounts] = await Promise.all(
            [fetcherWriter.writeSlotData(slotRes), fetcherWriter.writeEpochData(lidoIDs, epochRes)]
          );
        }
        this.latestSlotInDb = slotToWrite;
        return {lidoIDs, otherCounts};
      } catch (e) {
        this.logger.error('Error while fetching and writing new finalized slot or epoch info');
        this.logger.error(e as Error);
      }
    });
  }

  public async getPossibleHighRewardValidatorIndexes(valIDs: ValidatorID[], headEpoch: bigint): Promise<string[]> {
    return await this.prometheus.trackTask('high-reward-validators', async () => {
      this.logger.info('Start getting possible high reward validator indexes');
      const valIndexes: string[] = [];
      for (const i of valIDs) {
        valIndexes.push(i.validator_id);
      }
      const propDependentRoot = await this.lighthouse.getDutyDependentRoot(headEpoch);
      const [sync, prop] = await Promise.all([
        this.getSyncCommitteeDutyInfo(valIndexes, headEpoch),
        this.getProposerDutyInfo(valIndexes, propDependentRoot, headEpoch),
      ]);
      return [...(new Set([...sync, ...prop].map(v => v.validator_index)))];
    });
  }

  protected async getSyncCommitteeDutyInfo(valIndexes: string[], epoch: bigint): Promise<SyncCommitteeDutyInfo[]> {
    return await this.lighthouse.getSyncCommitteeDuties(epoch, valIndexes);
  }

  protected async getProposerDutyInfo(valIndexes: string[], dependentRoot: string, epoch: bigint): Promise<ProposerDutyInfo[]> {
    const proposersDutyInfo = await this.lighthouse.getCanonicalProposerDuties(epoch, dependentRoot);
    return proposersDutyInfo.filter((p) => valIndexes.includes(p.validator_index));
  }

  protected async getAttestersDutyInfo(valIndexes: string[], dependentRoot: string, epoch: bigint): Promise<AttesterDutyInfo[]> {
    return await this.lighthouse.getChunkedAttesterDuties(epoch, dependentRoot, valIndexes);
  }

  protected async getSyncCommitteeIndexedValidators(
    epoch: bigint, stateRoot: string, lidoIndexes: string[]
  ): Promise<SyncCommitteeValidator[][]> {
    const syncCommitteeInfo = await this.lighthouse.getSyncCommitteeInfo(stateRoot, epoch);
    const lidoSyncCommitteeVals: SyncCommitteeValidator[] = [];
    const allSyncCommitteeVals: SyncCommitteeValidator[] = [];
    syncCommitteeInfo.validators.forEach(
      (v, i) => {
        const indexed: SyncCommitteeValidator = {
          in_committee_index: i,
          validator_index: v,
          epoch_participation_percent: 0
        };
        allSyncCommitteeVals.push(indexed);
        if (lidoIndexes.includes(v)) lidoSyncCommitteeVals.push(indexed);
      }
    );
    return [lidoSyncCommitteeVals, allSyncCommitteeVals];
  }

  protected fetcherWriter = (
    slot: bigint,
    epoch: bigint,
    stateRoot: string,
    slotNumber: bigint,
    slotTime: bigint,
    keysIndexed: KeysIndexed
  ) => {
    return {
      fetchSlotData: async () => {
        this.logger.info('Start getting all validators balances');
        return await this.lighthouse.getBalances(stateRoot);
      },
      writeSlotData: async (slotRes: StateValidatorResponse[]) => {
        this.logger.info(
          `Start validators balance processing for slot ${slot} (state root ${stateRoot} from slot ${slotNumber})`
        );
        return await this.storage.writeBalances(slot, slotTime, slotRes, keysIndexed);
      },
      fetchEpochData: async (lidoIDs: ValidatorID[]) => {
        const lidoIndexes: string[] = [];
        for (const i of lidoIDs) {
          lidoIndexes.push(i.validator_id);
        }
        const [attesterDutyDependentRoot, proposerDutyDependentRoot] = await Promise.all(
          // for attester we should get root of previous epoch, for proposer - current
          [this.lighthouse.getDutyDependentRoot(epoch - 1n), this.lighthouse.getDutyDependentRoot(epoch)]
        );
        this.logger.info(`Attester Duty root: ${attesterDutyDependentRoot}`);
        this.logger.info(`Proposer Duty root: ${proposerDutyDependentRoot}`);
        const [attestations, proposeDutiesResult, syncResult] = await Promise.all([
          this.checkAttesterDuties(epoch, attesterDutyDependentRoot, lidoIndexes),
          this.checkProposerDuties(epoch, proposerDutyDependentRoot, lidoIndexes),
          this.checkSyncCommitteeDuties(epoch, stateRoot, lidoIndexes)
        ]);
        return {attestations, proposeDutiesResult, syncResult};
      },
      writeEpochData: async (lidoIDs: ValidatorID[], epochRes: FetchFinalizedEpochDataResult) => {
        this.logger.info(`Writing Lido ${epochRes.attestations.attestersDutyInfo.length} attestations result to DB for ${epoch} epoch`);
        await this.storage.writeAttestations(epochRes.attestations, slotTime, keysIndexed);
        this.logger.info(`Writing Lido ${epochRes.proposeDutiesResult.length} proposes result to DB for ${epoch} epoch`);
        await this.storage.writeProposes(epochRes.proposeDutiesResult, slotTime, keysIndexed);
        this.logger.info(
          `Writing Lido ${epochRes.syncResult.lido_validators.length} Sync Committee validators participation info to DB for ${epoch} epoch`
        );
        await this.storage.writeSyncs(epochRes.syncResult, slotTime, keysIndexed, lidoIDs, epoch);
      }
    };
  };

  /**
   * Check Attesters duties: get duties info by our validators keys and do bitwise attestations check
   **/
  protected async checkAttesterDuties(
    epoch: bigint, dutyDependentRoot: string, lidoIndexes: string[]
  ): Promise<CheckAttestersDutyResult> {
    return await this.prometheus.trackTask('check-attester-duties', async () => {
      this.logger.info(`Start getting Lido attesters duties info`);
      const attestersDutyInfo: AttesterDutyInfo[] = await this.getAttestersDutyInfo(lidoIndexes, dutyDependentRoot, epoch);
      this.logger.info(`Start processing Lido attesters duties info`);
      const blocksAttestations: { [block: string]: SlotAttestation[] } = {};
      let allMissedSlots: string[] = [];
      let lastBlockInfo: ShortBeaconBlockInfo | void;
      let lastMissedSlots: string[];
      // Check all slots from epoch start to last epoch slot + ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY
      const firstSlotInEpoch = epoch * 32n;
      const slotsToCheck: bigint[] = bigintRange(
        firstSlotInEpoch, firstSlotInEpoch + 32n + BigInt(this.env.ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY)
      );
      for (const slotToCheck of slotsToCheck) {
        if (lastBlockInfo && lastBlockInfo.message.slot > slotToCheck.toString()) {
          continue; // If we have lastBlockInfo > slotToCheck it means we have already processed this
        }
        [lastBlockInfo, lastMissedSlots] = await this.lighthouse.getBlockInfoWithSlotAttestations(slotToCheck);
        allMissedSlots = allMissedSlots.concat(lastMissedSlots);
        if (!lastBlockInfo) {
          continue; // Couldn't get information on the 8 nearest blocks
        }
        // A committee attestation can be included in a block as multiple parts.
        // It is necessary to group such attestations
        const groupedAttestations = groupBy(
          lastBlockInfo.message.body.attestations, ((att: BeaconBlockAttestation) => [att.data.slot, att.data.index].join('_'))
        );
        blocksAttestations[lastBlockInfo.message.slot.toString()] = Object.values(groupedAttestations).map(
          (group: BeaconBlockAttestation[]) => {
            // Need to perform a bitwise OR to get the full information about the committee attestation
            const bytesArray = fromHexString(group[0].aggregation_bits);
            const CommitteeBits = new BitVectorType({length: bytesArray.length * 8});
            const startBits = Array.from(CommitteeBits.deserialize(bytesArray));
            const aggregatedBits = group.reduce(
              (bits, att) => {
                const currBits = Array.from(CommitteeBits.deserialize(fromHexString(att.aggregation_bits)));
                return bits.map((val: boolean, index: number) => (val || currBits[index]));
              },
              startBits
            );
            return {
              bits: aggregatedBits,
              slot: group[0].data.slot,
              committee_index: group[0].data.index
            };
          }
        );
      }
      this.logger.info(`All missed slots in getting attestations info process: ${allMissedSlots}`);
      return {attestersDutyInfo, blocksAttestations, allMissedSlots};
    });
  }

  /**
   * Check Proposer duties and return Lido validators propose result
   **/
  protected async checkProposerDuties(epoch: bigint, dutyDependentRoot: string, valIndexes: string[]): Promise<ProposerDutyInfo[]> {
    return await this.prometheus.trackTask('check-proposer-duties', async () => {
      this.logger.info(`Start getting Lido proposers duties info`);
      const lidoProposersDutyInfo = await this.getProposerDutyInfo(valIndexes, dutyDependentRoot, epoch);
      this.logger.info(`Processing Lido proposers duties info`);
      for (const lidoProp of lidoProposersDutyInfo) {
        lidoProp.proposed = false;
        const blockInfo: ShortBeaconBlockInfo = await this.lighthouse.getBlockInfo(lidoProp.slot);
        if (!blockInfo) continue; // it means that block is missed
        if (blockInfo.message.proposer_index == lidoProp.validator_index) lidoProp.proposed = true;
        else {
          throw Error(
            `Proposer duty info cannot be trusted. Make sure the node is synchronized!
          Expect block [${blockInfo.message.slot}] proposer - ${lidoProp.validator_index},
          but actual - ${blockInfo.message.proposer_index}`
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
    epoch: bigint, stateRoot: string, lidoIndexes: string[]
  ): Promise<CheckSyncCommitteeParticipationResult> {
    return await this.prometheus.trackTask('check-sync-duties', async () => {
      this.logger.info(`Start getting Lido sync committee participation info`);
      const SyncCommitteeBits = new BitVectorType({length: 512}); // sync participants count in committee
      const [lido, all] = await this.getSyncCommitteeIndexedValidators(epoch, stateRoot, lidoIndexes);
      this.logger.info(`Processing Lido sync committee participation info`);
      if (lido.length === 0) {
        return {all_avg_participation: '', lido_validators: []};
      }
      const epochBlocks: ShortBeaconBlockInfo[] = [];
      const missedSlots: bigint[] = [];
      const startSlot = epoch * BigInt(this.env.FETCH_INTERVAL_SLOTS);
      for (let slot = startSlot; slot < startSlot + BigInt(this.env.FETCH_INTERVAL_SLOTS); slot = slot + 1n) {
        const blockInfo: ShortBeaconBlockInfo = await this.lighthouse.getBlockInfo(slot);
        blockInfo ? epochBlocks.push(blockInfo) : missedSlots.push(slot);
      }
      this.logger.info(`All missed slots in getting sync committee info process: ${missedSlots}`);
      const epochBlocksBits = epochBlocks.map(
        block =>
          Array.from(SyncCommitteeBits.deserialize(fromHexString(block.message.body.sync_aggregate.sync_committee_bits)))
      );
      for (const indexedValidator of all) {
        indexedValidator.epoch_participation_percent = (() => {
          let sync_count = 0;
          for (const bits of epochBlocksBits) {
            if (bits[indexedValidator.in_committee_index]) sync_count++;
          }
          return sync_count / epochBlocksBits.length * 100;
        })();
      }
      const allAvgParticipation = (
        all.reduce((a, b) => a + b.epoch_participation_percent, 0) / all.length
      ).toFixed(2);
      const lidoValidators = all.filter(v => lido.map(l => l.validator_index).includes(v.validator_index));

      return {all_avg_participation: allAvgParticipation, lido_validators: lidoValidators};
    });
  }
}
