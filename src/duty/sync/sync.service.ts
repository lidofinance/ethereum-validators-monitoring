import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockInfoResponse, ConsensusProviderService, SyncCommitteeValidator } from 'common/consensus-provider';
import { Epoch, Slot, StateId } from 'common/consensus-provider/types';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { SummaryService } from 'duty/summary';

import { SYNC_COMMITTEE_SIZE } from './sync.constants';

@Injectable()
export class SyncService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
  ) {}

  @TrackTask('check-sync-duties')
  public async check(epoch: Epoch, stateSlot: Slot): Promise<void> {
    this.logger.log(`Getting sync committee participation info`);
    const SyncCommitteeBits = new BitVectorType(SYNC_COMMITTEE_SIZE); // sync participants count in committee
    const indexedValidators = await this.getSyncCommitteeIndexedValidators(epoch, stateSlot);
    this.logger.log(`Processing sync committee participation info`);
    const epochBlocks: BlockInfoResponse[] = [];
    const missedSlots: number[] = [];
    const startSlot = epoch * this.config.get('FETCH_INTERVAL_SLOTS');
    for (let slot = startSlot; slot < startSlot + this.config.get('FETCH_INTERVAL_SLOTS'); slot = slot + 1) {
      const blockInfo = await this.clClient.getBlockInfo(slot);
      blockInfo ? epochBlocks.push(blockInfo) : missedSlots.push(slot);
    }
    this.logger.debug(`All missed slots in getting sync committee info process: ${missedSlots}`);
    const epochBlocksBits = epochBlocks.map((block) => {
      return {
        block: Number(block.message.slot),
        bits: SyncCommitteeBits.deserialize(fromHexString(block.message.body.sync_aggregate.sync_committee_bits)),
      };
    });
    for (const indexedValidator of indexedValidators) {
      const synced_blocks: number[] = [];
      for (const blockBits of epochBlocksBits) {
        if (blockBits.bits.get(indexedValidator.in_committee_index)) {
          synced_blocks.push(blockBits.block);
        }
      }
      const index = Number(indexedValidator.validator_index);
      const percent = (synced_blocks.length / epochBlocksBits.length) * 100;
      this.summary.epoch(epoch).set({
        epoch,
        val_id: index,
        is_sync: true,
        sync_percent: percent,
        sync_meta: {
          synced_blocks,
        },
      });
    }
    this.summary.epoch(epoch).setMeta({ sync: { blocks_to_sync: epochBlocksBits.map((b) => b.block) } });
  }

  public async getSyncCommitteeIndexedValidators(epoch: Epoch, stateId: StateId): Promise<SyncCommitteeValidator[]> {
    const syncCommitteeInfo = await this.clClient.getSyncCommitteeInfo(stateId, epoch);
    return syncCommitteeInfo.validators.map((v, i) => {
      return {
        in_committee_index: i,
        validator_index: v,
        epoch_participation_percent: 0,
      };
    });
  }
}
