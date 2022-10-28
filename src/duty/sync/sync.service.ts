import { BitVectorType, fromHexString } from '@chainsafe/ssz';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockInfoResponse, ConsensusProviderService, SyncCommitteeDutyInfo, SyncCommitteeValidator } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';
import { ValidatorIdentifications } from 'storage/clickhouse';

interface SyncCommitteeValidatorWithOtherAvg extends SyncCommitteeValidator {
  other_avg: number;
}

export interface SyncCommitteeValidatorPrepResult {
  syncResult: SyncCommitteeValidatorWithOtherAvg[];
  notUserAvgPercent: number;
}

@Injectable()
export class SyncService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
  ) {}

  public async getSyncCommitteeDutyInfo(valIndexes: string[], epoch: bigint): Promise<SyncCommitteeDutyInfo[]> {
    return await this.clClient.getSyncCommitteeDuties(epoch, valIndexes);
  }

  public async getSyncCommitteeIndexedValidators(epoch: bigint, stateRoot: string): Promise<SyncCommitteeValidator[]> {
    const syncCommitteeInfo = await this.clClient.getSyncCommitteeInfo(stateRoot, epoch);
    return syncCommitteeInfo.validators.map((v, i) => {
      return {
        in_committee_index: i,
        validator_index: v,
        epoch_participation_percent: 0,
      };
    });
  }

  /**
   * Check Sync committee duties: get duties info by our validators keys and do bitwise check
   **/
  public async checkSyncCommitteeDuties(epoch: bigint, stateRoot: string): Promise<SyncCommitteeValidator[]> {
    return await this.prometheus.trackTask('check-sync-duties', async () => {
      this.logger.log(`Start getting sync committee participation info`);
      const SyncCommitteeBits = new BitVectorType({ length: 512 }); // sync participants count in committee
      const indexedValidators = await this.getSyncCommitteeIndexedValidators(epoch, stateRoot);
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
        indexedValidator.epoch_participation_percent = (sync_count / epochBlocksBits.length) * 100;
      }
      return indexedValidators;
    });
  }

  public prepSyncCommitteeToWrite(
    userIDs: ValidatorIdentifications[],
    syncResult: SyncCommitteeValidator[],
  ): SyncCommitteeValidatorPrepResult {
    const notUserPercents = [];
    const userValidators = [];
    for (const p of syncResult) {
      const pubKey = userIDs.find((v) => v.validator_id === p.validator_index)?.validator_pubkey || '';
      if (pubKey) {
        const other = syncResult.filter((s) => s.validator_index != p.validator_index);
        userValidators.push({
          ...p,
          other_avg: other.reduce((a, b) => a + b.epoch_participation_percent, 0) / other.length,
        });
      } else {
        notUserPercents.push(p.epoch_participation_percent);
      }
    }

    const notUserAvgPercent = notUserPercents.length ? notUserPercents.reduce((a, b) => a + b, 0) / notUserPercents.length : undefined;
    return { syncResult: userValidators, notUserAvgPercent };
  }
}
