import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockInfoResponse, ConsensusProviderService } from 'common/eth-providers';
import { bigintRange } from 'common/functions/range';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { SummaryService } from '../summary';

interface SlotAttestation {
  included_in_block: bigint;
  bits: boolean[];
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
    this.savedCanonSlotsAttProperties.clear();
    const { attestations, allMissedSlots } = await this.getProcessedAttestations(epoch);
    this.logger.log(`Getting attestation duties info`);
    const committees = (await this.clClient.getAttestationCommitteesInfo(stateSlot, epoch)).map((c) => ({
      index: Number(c.index),
      slot: BigInt(c.slot),
      validators: c.validators.map((v) => BigInt(v)),
    }));
    this.logger.log(`Processing attestation duty info`);
    for (const committee of committees) {
      for (const attestation of attestations) {
        if (
          attestation.slot != committee.slot ||
          attestation.committee_index != committee.index ||
          attestation.included_in_block <= committee.slot
        )
          continue;
        const missedSlotsCount = allMissedSlots.filter(
          (missed) => missed > committee.slot && missed < attestation.included_in_block,
        ).length;
        const att_inc_delay = Number(attestation.included_in_block - committee.slot) - missedSlotsCount;
        const [canonHead, canonTarget, canonSource] = await Promise.all([
          this.getCanonSlotRoot(attestation.slot),
          this.getCanonSlotRoot(attestation.target_epoch * this.slotsInEpoch),
          this.getCanonSlotRoot(attestation.source_epoch * this.slotsInEpoch),
        ]);
        const att_valid_head = attestation.head == canonHead;
        const att_valid_target = attestation.target_root == canonTarget;
        const att_valid_source = attestation.source_root == canonSource;
        for (const [valCommIndex, validatorIndex] of committee.validators.entries()) {
          if (this.summary.get(validatorIndex)?.att_happened) continue;
          const att_happened = attestation.bits[valCommIndex];
          let summary = { epoch, val_id: validatorIndex, att_happened };
          const properties = { att_inc_delay, att_valid_head, att_valid_source, att_valid_target };
          if (att_happened) summary = { ...summary, ...properties };
          this.summary.set(validatorIndex, summary);
        }
      }
    }
  }

  protected async getCanonSlotRoot(slot: bigint) {
    const cached = this.savedCanonSlotsAttProperties.get(slot);
    if (cached) return cached;
    const root = (await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(slot)).root;
    this.savedCanonSlotsAttProperties.set(slot, root);
    return root;
  }

  protected async getProcessedAttestations(epoch: bigint) {
    this.logger.log(`Processing attestations from blocks info`);
    const attestations: SlotAttestation[] = [];
    let allMissedSlots: bigint[] = [];
    let lastBlockInfo: BlockInfoResponse | undefined;
    let lastMissedSlots: bigint[];
    // Check all slots from epoch start to last epoch slot + 32 (max inclusion delay)
    const firstSlotInEpoch = epoch * this.slotsInEpoch;
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
        const bytesArray = fromHexString(att.aggregation_bits);
        const CommitteeBits = new BitVectorType(bytesArray.length * 8);
        attestations.push({
          included_in_block: BigInt(lastBlockInfo.message.slot),
          bits: CommitteeBits.deserialize(bytesArray).toBoolArray(),
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
}
