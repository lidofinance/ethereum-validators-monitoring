import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { AttesterDutyInfo, BeaconBlockAttestation, BlockInfoResponse, ConsensusProviderService } from 'common/eth-providers';
import { bigintRange } from 'common/functions/range';
import { PrometheusService } from 'common/prometheus';
import { CheckAttestersDutyResult, SlotAttestation } from 'storage/clickhouse';

@Injectable()
export class AttestationService {
  savedCanonSlotsAttProperties = {};
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
  ) {}

  public async getAttestersDutyInfo(valIndexes: string[], dependentRoot: string, epoch: bigint): Promise<AttesterDutyInfo[]> {
    return await this.clClient.getChunkedAttesterDuties(epoch, dependentRoot, valIndexes);
  }

  protected async getCanonSlotRoot(slot: bigint) {
    const cached = this.savedCanonSlotsAttProperties[String(slot)];
    if (cached) return cached;
    const root = (await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(slot)).root;
    this.savedCanonSlotsAttProperties[String(slot)] = root;
    return root;
  }
  /**
   * Check Attesters duties: get duties info by our validators keys and do bitwise attestations check
   **/
  public async checkAttesterDuties(epoch: bigint, dutyDependentRoot: string, userIndexes: string[]): Promise<CheckAttestersDutyResult> {
    return await this.prometheus.trackTask('check-attester-duties', async () => {
      this.logger.log(`Start getting attesters duties info`);
      const attestersDutyInfo: AttesterDutyInfo[] = await this.getAttestersDutyInfo(userIndexes, dutyDependentRoot, epoch);
      this.logger.log(`Start processing attesters duties info`);
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
      this.logger.log(`All missed slots in getting attestations info process: ${allMissedSlots}`);
      return { attestersDutyInfo, blocksAttestations, allMissedSlots };
    });
  }

  public async prepAttestationsToWrite(attDutyResult: CheckAttestersDutyResult) {
    this.savedCanonSlotsAttProperties = {};
    const slotsInEpoch = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    const blocksAttestation = Object.entries(attDutyResult.blocksAttestations).sort(
      (b1, b2) => parseInt(b1[0]) - parseInt(b2[0]), // Sort array by block number
    );
    for (const duty of attDutyResult.attestersDutyInfo) {
      duty.attested = false;
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
          const missedSlotsCount = attDutyResult.allMissedSlots.filter(
            (missed) => BigInt(missed) > BigInt(duty.slot) && BigInt(missed) < BigInt(block),
          ).length;
          duty.inclusion_delay = Number(BigInt(block) - BigInt(duty.slot)) - missedSlotsCount;
          const [canonHead, canonTarget, canonSource] = await Promise.all([
            this.getCanonSlotRoot(BigInt(ca.slot)),
            this.getCanonSlotRoot(BigInt(ca.target_epoch) * slotsInEpoch),
            this.getCanonSlotRoot(BigInt(ca.source_epoch) * slotsInEpoch),
          ]);
          duty.valid_head = ca.head == canonHead;
          duty.valid_target = ca.target_root == canonTarget;
          duty.valid_source = ca.source_root == canonSource;
          break;
        }
        if (duty.attested) break;
      }
    }
    return attDutyResult;
  }
}
