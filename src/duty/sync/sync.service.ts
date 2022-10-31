import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockInfoResponse, ConsensusProviderService, SyncCommitteeValidator } from 'common/eth-providers';
import { StateId } from 'common/eth-providers/consensus-provider/types';
import { PrometheusService } from 'common/prometheus';

import { SummaryService } from '../summary';

@Injectable()
export class SyncService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
  ) {}

  public async check(epoch: bigint, stateSlot: bigint): Promise<void> {
    return await this.prometheus.trackTask('check-sync-duties', async () => {
      this.logger.log(`Getting sync committee participation info`);
      const SyncCommitteeBits = new BitVectorType({ length: 512 }); // sync participants count in committee
      const indexedValidators = await this.getSyncCommitteeIndexedValidators(epoch, stateSlot);
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
        const index = BigInt(indexedValidator.validator_index);
        const percent = (sync_count / epochBlocksBits.length) * 100;
        this.summary.set(index, {
          epoch,
          val_id: index,
          is_sync: true,
          sync_percent: percent,
          sync_is_compete: true,
        });
      }
    });
  }

  public async getSyncCommitteeIndexedValidators(epoch: bigint, stateId: StateId): Promise<SyncCommitteeValidator[]> {
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
