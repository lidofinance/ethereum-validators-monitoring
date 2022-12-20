import { BitArray, BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';

import { ConfigService } from 'common/config';
import { BlockInfoResponse, ConsensusProviderService } from 'common/eth-providers';
import { bigintRange } from 'common/functions/range';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { SummaryService } from '../summary';
import { MISSED_ATTESTATION, attestationPenalties, attestationRewards } from './attestation.constants';

interface SlotAttestation {
  included_in_block: bigint;
  bits: BitArray;
  head: string;
  target_root: string;
  target_epoch: bigint;
  source_root: string;
  source_epoch: bigint;
  slot: bigint;
  committee_index: number;
}

@Injectable()
export class AttestationService {
  private processedEpoch: bigint;
  private readonly slotsInEpoch: bigint;
  private readonly savedCanonSlotsAttProperties: Map<bigint, string>;
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
  ) {
    this.slotsInEpoch = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    this.savedCanonSlotsAttProperties = new Map<bigint, string>();
  }

  @TrackTask('check-attestation-duties')
  public async check(epoch: bigint, stateSlot: bigint): Promise<void> {
    this.processedEpoch = epoch;
    this.savedCanonSlotsAttProperties.clear();
    const { attestations } = await this.getProcessedAttestations();
    this.logger.log(`Getting attestation duties info`);
    const committees = await this.getAttestationCommittees(stateSlot);
    this.logger.log(`Processing attestation duty info`);
    const counters = {
      correctSourceCount: 0,
      correctTargetCount: 0,
      correctHeadCount: 0,
    };
    for (const attestation of attestations) {
      // Each attestation corresponds to committee. Committee may have several aggregate attestations
      const committee = committees.get(`${attestation.committee_index}_${attestation.slot}`);
      if (!committee) continue;
      await this.processAttestation(attestation, committee, counters);
      await new Promise((resolve) => {
        // Long loop (2048 committees will be checked by ~7k attestations).
        // We need to unblock event loop immediately after each iteration
        // It makes this cycle slower but safer (but since it is executed async, impact will be minimal)
        // If we don't do this, it can freeze scraping Prometheus metrics and other important operations
        // Source: https://snyk.io/blog/nodejs-how-even-quick-async-functions-can-block-the-event-loop-starve-io/
        return setImmediate(() => resolve(true));
      });
    }
    this.summary.setMeta({
      attestation: {
        correct_source: counters.correctSourceCount,
        correct_target: counters.correctTargetCount,
        correct_head: counters.correctHeadCount,
      },
    });
  }

  protected async processAttestation(attestation: SlotAttestation, committee: bigint[], counters) {
    const [canonHead, canonTarget, canonSource] = await Promise.all([
      this.getCanonSlotRoot(attestation.slot),
      this.getCanonSlotRoot(attestation.target_epoch * this.slotsInEpoch),
      this.getCanonSlotRoot(attestation.source_epoch * this.slotsInEpoch),
    ]);
    const att_valid_head = attestation.head == canonHead;
    const att_valid_target = attestation.target_root == canonTarget;
    const att_valid_source = attestation.source_root == canonSource;
    const att_inc_delay = Number(attestation.included_in_block - attestation.slot);
    const reward_per_increment = attestationRewards(att_inc_delay, att_valid_source, att_valid_target, att_valid_head);
    const penalty_per_increment = attestationPenalties(att_inc_delay, att_valid_source, att_valid_target, att_valid_head);
    for (const [valCommIndex, validatorIndex] of committee.entries()) {
      const isProcessed = this.summary.get(validatorIndex)?.att_happened;
      if (isProcessed) continue; // already processed validator. it was in one of previous attestation
      const att_happened = attestation.bits.get(valCommIndex);
      if (!att_happened) {
        this.summary.set(validatorIndex, { epoch: this.processedEpoch, val_id: validatorIndex, ...MISSED_ATTESTATION });
        continue;
      }
      // Count for calculate multipliers of rewards
      if (reward_per_increment.source != 0) counters.correctSourceCount++;
      if (reward_per_increment.target != 0) counters.correctTargetCount++;
      if (reward_per_increment.head != 0) counters.correctHeadCount++;
      this.summary.set(validatorIndex, {
        val_id: validatorIndex,
        epoch: this.processedEpoch,
        att_happened: true,
        att_inc_delay,
        att_valid_head,
        att_valid_source,
        att_valid_target,
        att_meta: {
          included_in_block: attestation.included_in_block,
          reward_per_increment,
          penalty_per_increment,
        },
      });
    }
  }

  protected async getCanonSlotRoot(slot: bigint) {
    const cached = this.savedCanonSlotsAttProperties.get(slot);
    if (cached) return cached;
    const root = (await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(slot)).root;
    this.savedCanonSlotsAttProperties.set(slot, root);
    return root;
  }

  @TrackTask('process-chain-attestations')
  protected async getProcessedAttestations() {
    this.logger.log(`Processing attestations from blocks info`);
    // todo: Should we check orphaned blocks and how? eg. https://beaconcha.in/slot/5306177
    const bitsMap = new Map<string, BitArray>();
    const attestations: SlotAttestation[] = [];
    let allMissedSlots: bigint[] = [];
    let lastBlockInfo: BlockInfoResponse | undefined;
    let lastMissedSlots: bigint[];
    // Check all slots from epoch start to last epoch slot + 32 (max inclusion delay)
    const firstSlotInEpoch = this.processedEpoch * this.slotsInEpoch;
    const slotsToCheck: bigint[] = bigintRange(firstSlotInEpoch, firstSlotInEpoch + this.slotsInEpoch * 2n);
    for (const slotToCheck of slotsToCheck) {
      if (lastBlockInfo && lastBlockInfo.message.slot > slotToCheck.toString()) {
        continue; // If we have lastBlockInfo > slotToCheck it means we have already processed this
      }
      [lastBlockInfo, lastMissedSlots] = await this.clClient.getBlockInfoWithSlotAttestations(slotToCheck);
      allMissedSlots = allMissedSlots.concat(lastMissedSlots);
      if (!lastBlockInfo) {
        continue; // Failed to get info about the nearest existing block
      }
      for (const att of lastBlockInfo.message.body.attestations) {
        let bits = bitsMap.get(att.aggregation_bits);
        if (!bits) {
          const bytesArray = fromHexString(att.aggregation_bits);
          const CommitteeBits = new BitVectorType(bytesArray.length * 8);
          bits = CommitteeBits.deserialize(bytesArray);
          bitsMap.set(att.aggregation_bits, bits);
        }
        attestations.push({
          included_in_block: BigInt(lastBlockInfo.message.slot),
          bits: bits,
          head: att.data.beacon_block_root,
          target_root: att.data.target.root,
          target_epoch: BigInt(att.data.target.epoch),
          source_root: att.data.source.root,
          source_epoch: BigInt(att.data.source.epoch),
          slot: BigInt(att.data.slot),
          committee_index: Number(att.data.index),
        });
      }
    }
    this.logger.debug(`All missed slots in getting attestations info process: ${allMissedSlots}`);
    return { attestations, allMissedSlots };
  }

  @TrackTask('get-attestation-committees')
  protected async getAttestationCommittees(stateSlot: bigint): Promise<Map<string, bigint[]>> {
    const readStream = await this.clClient.getAttestationCommitteesInfo(stateSlot, this.processedEpoch);
    const committees = new Map<string, bigint[]>();
    const pipeline = chain([readStream, parser(), pick({ filter: 'data' }), streamArray(), (data) => data.value]);
    const streamTask = async () =>
      new Promise((resolve, reject) => {
        pipeline.on('data', (committee) =>
          committees.set(
            `${committee.index}_${committee.slot}`,
            committee.validators.map((v) => BigInt(v)),
          ),
        );
        pipeline.on('error', (error) => reject(error));
        pipeline.on('end', () => resolve(true));
      });
    await streamTask().finally(() => pipeline.destroy());
    return committees;
  }
}
