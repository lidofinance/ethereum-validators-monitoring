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
  savedCanonSlotsAttProperties = {};
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
  ) {}

  public async check(epoch: bigint, stateSlot: bigint): Promise<void> {
    return await this.prometheus.trackTask('check-attester-duties', async () => {
      this.logger.log(`Getting attesters duties info`);
      // const attestersDutyInfo: AttesterDutyInfo[] = await this.getAttestersDutyInfo(userIndexes, dutyDependentRoot, epoch);
      const attestationCommitteesInfo = await this.clClient.getAttestationCommitteesInfo(stateSlot, epoch);
      this.logger.log(`Processing attesters duties info`);
      const blocksAttestations: { [block: string]: SlotAttestation[] } = {};
      let allMissedSlots: string[] = [];
      let lastBlockInfo: BlockInfoResponse | void;
      let lastMissedSlots: string[];
      // Check all slots from epoch start to last epoch slot + 32 (max inclusion delay)
      const slotsInEpoch = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
      const firstSlotInEpoch = epoch * slotsInEpoch;
      const slotsToCheck: bigint[] = bigintRange(firstSlotInEpoch, firstSlotInEpoch + slotsInEpoch * 2n);
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
      this.savedCanonSlotsAttProperties = {};
      const blocksAttestation = Object.entries(blocksAttestations).sort(
        (b1, b2) => parseInt(b1[0]) - parseInt(b2[0]), // Sort array by block number
      );
      for (const committee of attestationCommitteesInfo) {
        for (const [valCommIndex, validatorIndex] of committee.validators.entries()) {
          let attested = false;
          let inc_delay = undefined;
          let valid_head = undefined;
          let valid_target = undefined;
          let valid_source = undefined;
          for (const [block, blockAttestations] of blocksAttestation.filter(
            ([b]) => BigInt(b) > BigInt(committee.slot), // Attestation cannot be included in the previous or current block
          )) {
            const committeeAttestations: SlotAttestation[] = blockAttestations.filter(
              (att: any) => att.slot == committee.slot && att.committee_index == committee.index,
            );
            if (!committeeAttestations) continue;
            for (const ca of committeeAttestations) {
              attested = ca.bits[valCommIndex];
              if (!attested) continue; // continue to find attestation with validator attestation
              // and if validator attests block - calculate inclusion delay and check properties (head, target, source)
              // calculate inclusion delay
              const missedSlotsCount = allMissedSlots.filter(
                (missed) => BigInt(missed) > BigInt(committee.slot) && BigInt(missed) < BigInt(block),
              ).length;
              inc_delay = Number(BigInt(block) - BigInt(committee.slot)) - missedSlotsCount;
              const [canonHead, canonTarget, canonSource] = await Promise.all([
                this.getCanonSlotRoot(BigInt(ca.slot)),
                this.getCanonSlotRoot(BigInt(ca.target_epoch) * slotsInEpoch),
                this.getCanonSlotRoot(BigInt(ca.source_epoch) * slotsInEpoch),
              ]);
              valid_head = ca.head == canonHead;
              valid_target = ca.target_root == canonTarget;
              valid_source = ca.source_root == canonSource;
              break;
            }
            if (attested) break;
          }
          this.summary.set(BigInt(validatorIndex), {
            epoch,
            val_id: BigInt(validatorIndex),
            att_inc_delay: attested ? inc_delay : 33,
            att_valid_head: valid_head,
            att_valid_target: valid_target,
            att_valid_source: valid_source,
          });
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
}
