import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BeaconBlockAttestation, BlockInfoResponse, ConsensusProviderService } from 'common/eth-providers';
import { bigintRange } from 'common/functions/range';
import { PrometheusService } from 'common/prometheus';
import { SlotAttestation } from 'storage/clickhouse';

import { SummaryService } from '../summary';

@Injectable()
export class AttestationService {
  private readonly slotsInEpoch;
  private savedCanonSlotsAttProperties = {};
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
  ) {
    this.slotsInEpoch = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
  }

  public async check(epoch: bigint, stateSlot: bigint): Promise<void> {
    return await this.prometheus.trackTask('check-attestation-duties', async () => {
      const { blocksAttestations, allMissedSlots } = await this.getProcessedAttestations(epoch);
      this.savedCanonSlotsAttProperties = {};
      this.logger.log(`Getting attestation duties info`);
      const committees = await this.clClient.getAttestationCommitteesInfo(stateSlot, epoch);
      this.logger.log(`Processing attestation duty info`);
      for (const committee of committees) {
        for (const [block, blockAttestations] of Object.entries(blocksAttestations).filter(
          ([b]) => BigInt(b) > BigInt(committee.slot), // Attestation cannot be included in the previous or current block
        )) {
          const attestations: SlotAttestation[] = blockAttestations.filter(
            (att: any) => att.slot == committee.slot && att.committee_index == committee.index,
          );
          if (!attestations) continue; // try to find committee attestations in another next block
          for (const attestation of attestations) {
            const [canonHead, canonTarget, canonSource] = await Promise.all([
              this.getCanonSlotRoot(BigInt(attestation.slot)),
              this.getCanonSlotRoot(BigInt(attestation.target_epoch) * this.slotsInEpoch),
              this.getCanonSlotRoot(BigInt(attestation.source_epoch) * this.slotsInEpoch),
            ]);
            const att_valid_head = attestation.head == canonHead;
            const att_valid_target = attestation.target_root == canonTarget;
            const att_valid_source = attestation.source_root == canonSource;
            for (const [valCommIndex, validatorIndex] of committee.validators.entries()) {
              if (this.summary.get(BigInt(validatorIndex))?.att_happened) continue;
              const att_happened = attestation.bits[valCommIndex];
              const missedSlotsCount = allMissedSlots.filter(
                (missed) => BigInt(missed) > BigInt(committee.slot) && BigInt(missed) < BigInt(block),
              ).length;
              const att_inc_delay = Number(BigInt(block) - BigInt(committee.slot)) - missedSlotsCount;
              let summary = { epoch, val_id: BigInt(validatorIndex), att_happened };
              const properties = { att_inc_delay, att_valid_head, att_valid_source, att_valid_target };
              if (att_happened) summary = { ...summary, ...properties };
              this.summary.set(BigInt(validatorIndex), summary);
            }
          }
        }
      }
    });
  }

  protected async getCanonSlotRoot(slot: bigint) {
    const cached = this.savedCanonSlotsAttProperties[String(slot)];
    if (cached) return cached;
    const root = (await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(slot)).root;
    this.savedCanonSlotsAttProperties[String(slot)] = root;
    return root;
  }

  protected async getProcessedAttestations(epoch: bigint) {
    this.logger.log(`Processing attestations from blocks info`);
    const blocksAttestations: { [block: string]: SlotAttestation[] } = {};
    let allMissedSlots: string[] = [];
    let lastBlockInfo: BlockInfoResponse | void;
    let lastMissedSlots: string[];
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
      blocksAttestations[lastBlockInfo.message.slot.toString()] = lastBlockInfo.message.body.attestations.map(
        (att: BeaconBlockAttestation) => {
          const bytesArray = fromHexString(att.aggregation_bits);
          const CommitteeBits = new BitVectorType({
            length: bytesArray.length * 8,
          });
          return {
            bits: Array.from(CommitteeBits.deserialize(bytesArray)),
            head: att.data.beacon_block_root,
            target_root: att.data.target.root,
            target_epoch: att.data.target.epoch,
            source_root: att.data.source.root,
            source_epoch: att.data.source.epoch,
            slot: att.data.slot,
            committee_index: att.data.index,
          };
        },
      );
    }
    this.logger.debug(`All missed slots in getting attestations info process: ${allMissedSlots}`);
    return { blocksAttestations, allMissedSlots };
  }
}
