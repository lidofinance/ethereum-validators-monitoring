import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockInfoResponse, ConsensusProviderService } from 'common/eth-providers';
import { bigintRange } from 'common/functions/range';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { SummaryService } from '../summary';
import { attestationPenalties, attestationRewards, timelyHead, timelySource, timelyTarget } from './attestation.constants';

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
    const { attestations } = await this.getProcessedAttestations(epoch);
    this.logger.log(`Getting attestation duties info`);
    const committees = (await this.clClient.getAttestationCommitteesInfo(stateSlot, epoch)).map((c) => ({
      index: Number(c.index),
      slot: BigInt(c.slot),
      validators: c.validators.map((v) => BigInt(v)),
    }));
    this.logger.log(`Processing attestation duty info`);
    let correctSourceCount = 0;
    let correctTargetCount = 0;
    let correctHeadCount = 0;
    for (const committee of committees) {
      for (const attestation of attestations) {
        if (
          attestation.slot != committee.slot ||
          attestation.committee_index != committee.index ||
          attestation.included_in_block <= committee.slot
        )
          continue;
        const [canonHead, canonTarget, canonSource] = await Promise.all([
          this.getCanonSlotRoot(attestation.slot),
          this.getCanonSlotRoot(attestation.target_epoch * this.slotsInEpoch),
          this.getCanonSlotRoot(attestation.source_epoch * this.slotsInEpoch),
        ]);
        const att_valid_head = attestation.head == canonHead;
        const att_valid_target = attestation.target_root == canonTarget;
        const att_valid_source = attestation.source_root == canonSource;
        const att_inc_delay = Number(attestation.included_in_block - committee.slot);
        const reward_per_increment = attestationRewards(att_inc_delay, att_valid_source, att_valid_target, att_valid_head);
        const penalty_per_increment = attestationPenalties(att_inc_delay, att_valid_source, att_valid_target, att_valid_head);
        const properties = { att_inc_delay, att_valid_head, att_valid_source, att_valid_target };
        for (const [valCommIndex, validatorIndex] of committee.validators.entries()) {
          const att_happened = attestation.bits[valCommIndex];
          const fromSummary = this.summary.get(validatorIndex);
          if (fromSummary?.att_happened) continue;
          let summary = {
            epoch,
            val_id: validatorIndex,
            att_happened,
            att_meta: {
              included_in_block: undefined,
              reward_per_increment: attestationRewards(32, false, false, false),
              penalty_per_increment: attestationPenalties(32, false, false, false),
            },
          };
          if (att_happened) {
            const att_meta = {
              included_in_block: attestation.included_in_block,
              reward_per_increment,
              penalty_per_increment,
            };
            summary = { ...summary, ...properties, att_meta };
            // Count for calculate multipliers of rewards
            if (timelySource(att_inc_delay, att_valid_source)) correctSourceCount++;
            if (timelyTarget(att_inc_delay, att_valid_target)) correctTargetCount++;
            if (timelyHead(att_inc_delay, att_valid_head)) correctHeadCount++;
          }
          this.summary.set(validatorIndex, summary);
        }
      }
    }
    this.summary.setMeta(epoch, {
      attestation: { correct_source: correctSourceCount, correct_target: correctTargetCount, correct_head: correctHeadCount },
    });
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
