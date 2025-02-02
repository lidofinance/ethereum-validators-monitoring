import { BitArray, BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { batch } from 'stream-json/utils/Batch';

import { ConfigService } from 'common/config';
import { AttestationCommitteeInfo, ConsensusProviderService } from 'common/consensus-provider';
import { Epoch, Slot } from 'common/consensus-provider/types';
import { allSettled } from 'common/functions/allSettled';
import { range } from 'common/functions/range';
import { unblock } from 'common/functions/unblock';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { SummaryService } from 'duty/summary';

import { getFlags } from './attestation.constants';

interface SlotAttestation {
  includedInBlock: number;
  aggregationBits: BitArray;
  committeeIndexes: number[];
  head: string;
  targetRoot: string;
  targetEpoch: Epoch;
  sourceRoot: string;
  sourceEpoch: Epoch;
  slot: number;
}

@Injectable()
export class AttestationService {
  private processedEpoch: number;
  private readonly slotsInEpoch: number;
  private readonly dencunEpoch: Epoch;
  private readonly savedCanonSlotsAttProperties: Map<number, string>;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
  ) {
    this.slotsInEpoch = this.config.get('FETCH_INTERVAL_SLOTS');
    this.dencunEpoch = this.config.get('DENCUN_FORK_EPOCH');
    this.savedCanonSlotsAttProperties = new Map<number, string>();
  }

  @TrackTask('check-attestation-duties')
  public async check(epoch: Epoch, stateSlot: Slot): Promise<void> {
    this.processedEpoch = epoch;
    this.savedCanonSlotsAttProperties.clear();
    this.logger.log(`Getting attestations and duties info`);
    const [attestations, committees] = await allSettled([this.getProcessedAttestations(), this.getAttestationCommittees(stateSlot)]);
    this.logger.log(`Processing attestation duty info`);

    const firstSlotInPreviousEpoch = (epoch - 1) * this.slotsInEpoch;
    const maxBatchSize = 5;
    let index = 0;
    for (const attestation of attestations) {
      // These attestations have been processed in previous cycles
      if (attestation.slot <= firstSlotInPreviousEpoch - 1) {
        continue;
      }

      await this.processAttestation(epoch, attestation, committees);
      // Long loop (2048 committees will be checked by ~7k attestations).
      // We need to unblock event loop immediately after each iteration
      // It makes this cycle slower but safer (but since it is executed async, impact will be minimal)
      // If we don't do this, it can freeze scraping Prometheus metrics and other important operations
      index++;
      if (index % maxBatchSize == 0) {
        await unblock();
      }
    }
  }

  protected async processAttestation(epoch: Epoch, attestation: SlotAttestation, committees: Map<string, number[]>) {
    const attestationFlags = { source: [], target: [], head: [] };
    const [canonHead, canonTarget, canonSource] = await allSettled([
      this.getCanonSlotRoot(attestation.slot),
      this.getCanonSlotRoot(attestation.targetEpoch * this.slotsInEpoch),
      this.getCanonSlotRoot(attestation.sourceEpoch * this.slotsInEpoch),
    ]);
    const attValidHead = attestation.head === canonHead;
    const attValidTarget = attestation.targetRoot === canonTarget;
    const attValidSource = attestation.sourceRoot === canonSource;
    const attIncDelay = Number(attestation.includedInBlock - attestation.slot);
    const isDencunFork = epoch >= this.dencunEpoch;
    const flags = getFlags(attIncDelay, attValidSource, attValidTarget, attValidHead, isDencunFork);

    let committeeOffset = 0;
    for (const committeeIndex of attestation.committeeIndexes) {
      // Each attestation corresponds to committee. Committee may have several aggregate attestations
      const committee = committees.get(`${committeeIndex}_${attestation.slot}`);

      if (committee == null) {
        throw Error(`Committee ${committeeIndex} for attestation in slot ${attestation.slot} does not exist`);
      }

      for (const [valCommIndex, validatorIndex] of committee.entries()) {
        const attHappened = attestation.aggregationBits.get(committeeOffset + valCommIndex);
        if (!attHappened) {
          continue;
        }
        const processed = this.summary.epoch(attestation.targetEpoch).get(validatorIndex);
        if (!processed?.att_valid_source && flags.source) {
          attestationFlags.source.push(validatorIndex);
        }
        if (!processed?.att_valid_target && flags.target) {
          attestationFlags.target.push(validatorIndex);
        }
        if (!processed?.att_valid_head && flags.head) {
          attestationFlags.head.push(validatorIndex);
        }
        this.summary.epoch(attestation.targetEpoch).set({
          val_id: validatorIndex,
          epoch: attestation.targetEpoch,
          att_happened: attHappened,
          att_inc_delay: processed?.att_inc_delay || attIncDelay,
          att_valid_source: processed?.att_valid_source || flags.source,
          att_valid_target: processed?.att_valid_target || flags.target,
          att_valid_head: processed?.att_valid_head || flags.head,
        });
      }

      committeeOffset += committee.length;
    }

    const blocksAttestations = this.summary.epoch(epoch).getMeta().attestation.blocks_attestations;
    const blockMeta = blocksAttestations.get(attestation.includedInBlock);
    blockMeta.push(attestationFlags);
    blocksAttestations.set(attestation.includedInBlock, blockMeta);
    this.summary.epoch(epoch).setMeta({ attestation: { blocks_attestations: blocksAttestations } });
  }

  protected async getCanonSlotRoot(slot: Slot) {
    const cached = this.savedCanonSlotsAttProperties.get(slot);
    if (cached) {
      return cached;
    }
    const root = (await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(slot)).root;
    this.savedCanonSlotsAttProperties.set(slot, root);
    return root;
  }

  @TrackTask('process-chain-attestations')
  protected async getProcessedAttestations() {
    this.logger.log(`Processing attestations from blocks info`);
    const aggregationBitsMap = new Map<string, BitArray>();
    const committeeIndexesMap = new Map<string, number[]>();
    const attestations: SlotAttestation[] = [];
    const allMissedSlots: number[] = [];
    // Check all slots from previous epoch start to current epoch last slot
    const firstSlotInEpoch = this.processedEpoch * this.slotsInEpoch;
    const slotsToCheck: number[] = range(firstSlotInEpoch - this.slotsInEpoch, firstSlotInEpoch + this.slotsInEpoch);
    for (const slotToCheck of slotsToCheck) {
      const block = await this.clClient.getBlockInfo(slotToCheck);
      if (!block) {
        allMissedSlots.push(slotToCheck);
        continue;
      }
      for (const att of block.message.body.attestations) {
        let aggregationBits = aggregationBitsMap.get(att.aggregation_bits);
        let committeeIndexes = committeeIndexesMap.get(att.committee_bits);

        if (aggregationBits == null) {
          const bytesArray = fromHexString(att.aggregation_bits);
          const aggregationBitsVector = new BitVectorType(bytesArray.length * 8);
          aggregationBits = aggregationBitsVector.deserialize(bytesArray);
          aggregationBitsMap.set(att.aggregation_bits, aggregationBits);
        }
        if (committeeIndexes == null) {
          const bytesArray = fromHexString(att.committee_bits);
          const committeeBitsVector = new BitVectorType(bytesArray.length * 8);
          const committeeBitsArray = committeeBitsVector.deserialize(bytesArray);
          committeeIndexes = committeeBitsArray.getTrueBitIndexes();
          committeeIndexesMap.set(att.committee_bits, committeeIndexes);
        }

        attestations.push({
          includedInBlock: Number(block.message.slot),
          aggregationBits,
          committeeIndexes,
          head: att.data.beacon_block_root,
          targetRoot: att.data.target.root,
          targetEpoch: Number(att.data.target.epoch),
          sourceRoot: att.data.source.root,
          sourceEpoch: Number(att.data.source.epoch),
          slot: Number(att.data.slot),
        });
      }
    }
    this.logger.debug(`All missed slots in getting attestations info process: ${allMissedSlots}`);
    return attestations;
  }

  @TrackTask('get-attestation-committees')
  protected async getAttestationCommittees(stateSlot: Slot): Promise<Map<string, number[]>> {
    const committees = new Map<string, number[]>();
    const [prevStream, currStream] = await allSettled([
      this.clClient.getAttestationCommitteesInfo(stateSlot, this.processedEpoch - 1),
      this.clClient.getAttestationCommitteesInfo(stateSlot, this.processedEpoch),
    ]);
    const prevPipeline = chain([
      prevStream,
      parser(),
      pick({ filter: 'data' }),
      streamArray(),
      batch({ batchSize: 5 }),
      async (batch) => processBatch(this.processedEpoch - 1, batch),
    ]);
    const currPipeline = chain([
      currStream,
      parser(),
      pick({ filter: 'data' }),
      streamArray(),
      batch({ batchSize: 5 }),
      async (batch) => processBatch(this.processedEpoch, batch),
    ]);

    const processBatch = async (epoch: Epoch, batch) => {
      await unblock();
      for (const data of batch) {
        const committee: AttestationCommitteeInfo = data.value;
        // validator doesn't attests by default
        committee.validators.forEach((index) =>
          this.summary.epoch(epoch).set({ epoch: epoch, val_id: Number(index), att_happened: false }),
        );
        committees.set(
          `${committee.index}_${committee.slot}`,
          committee.validators.map((v) => Number(v)),
        );
      }
    };

    const pipelineFinish = async (pipeline) => {
      pipeline.on('data', (batch) => batch);
      return new Promise((resolve, reject) => {
        pipeline.on('error', (error) => reject(error));
        pipeline.on('end', () => resolve(true));
      }).finally(() => pipeline.destroy());
    };

    await allSettled([pipelineFinish(prevPipeline), pipelineFinish(currPipeline)]);

    return committees;
  }
}
