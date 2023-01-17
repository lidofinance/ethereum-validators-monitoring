import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/eth-providers';
import { BlockCacheService } from 'common/eth-providers/consensus-provider/block-cache';
import { Epoch, Slot } from 'common/eth-providers/consensus-provider/types';
import { range } from 'common/functions/range';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { ClickhouseService } from 'storage';

import { AttestationService } from './attestation';
import { TIMELY_HEAD_WEIGHT, TIMELY_SOURCE_WEIGHT, TIMELY_TARGET_WEIGHT } from './attestation/attestation.constants';
import { DutyRewards } from './duty.rewards';
import { ProposeService } from './propose';
import { PROPOSER_WEIGHT, WEIGHT_DENOMINATOR } from './propose/propose.constants';
import { StateService } from './state';
import { SummaryService } from './summary';
import { SyncService } from './sync';
import { syncReward } from './sync/sync.constants';

@Injectable()
export class DutyService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly blockCacheService: BlockCacheService,

    protected readonly state: StateService,
    protected readonly attestation: AttestationService,
    protected readonly propose: ProposeService,
    protected readonly sync: SyncService,
    protected readonly summary: SummaryService,
    protected readonly storage: ClickhouseService,
    protected readonly rewards: DutyRewards,
  ) {}

  public async checkAndWrite({ epoch, stateSlot }: { epoch: Epoch; stateSlot: Slot }): Promise<string[]> {
    // Prefetch will be done before main checks because duty by state requests are heavy
    // and while we wait for their responses we fetch blocks and headers.
    // If for some reason prefetch task will be slower than duty by state requests,
    // blocks and headers will be fetched inside tasks of checks
    const [, , possibleHighRewardVals] = await Promise.all([
      this.prefetch(epoch),
      this.checkAll(epoch, stateSlot),
      this.getPossibleHighRewardValidators(),
    ]);
    await Promise.all([this.writeEpochMeta(epoch), this.writeSummary(epoch)]);
    this.summary.clear();
    await this.storage.updateEpochProcessing({ epoch, is_stored: true });
    return possibleHighRewardVals;
  }

  @TrackTask('check-all-duties')
  protected async checkAll(epoch: Epoch, stateSlot: Slot): Promise<any> {
    this.summary.clear();
    this.logger.log('Checking duties of validators');
    await Promise.all([
      this.state.check(epoch, stateSlot),
      this.attestation.check(epoch, stateSlot),
      this.sync.check(epoch, stateSlot),
      this.propose.check(epoch),
    ]);
    // must be done after all duties check
    await this.fillCurrentEpochMetadata(epoch);
    // calculate rewards after check all duties
    await this.rewards.calculate(epoch);
  }

  @TrackTask('prefetch-slots')
  protected async prefetch(epoch: Epoch): Promise<any> {
    this.blockCacheService.purgeOld(epoch);
    this.logger.log('Prefetching blocks header, info and write to cache');
    const slotsInEpoch = this.config.get('FETCH_INTERVAL_SLOTS');
    const firstSlotInEpoch = epoch * slotsInEpoch;
    const slots: number[] = range(firstSlotInEpoch - slotsInEpoch, firstSlotInEpoch + slotsInEpoch);
    const toFetch = slots.map((s) => [this.clClient.getBlockHeader(s), this.clClient.getBlockInfo(s)]).flat();
    while (toFetch.length > 0) {
      const chunk = toFetch.splice(0, 32);
      await Promise.all(chunk);
    }
  }

  @TrackTask('high-reward-validators')
  public async getPossibleHighRewardValidators(): Promise<string[]> {
    const actualSlotHeader = <BlockHeaderResponse>await this.clClient.getBlockHeader('head');
    const headEpoch = Math.trunc(actualSlotHeader.header.message.slot / this.config.get('FETCH_INTERVAL_SLOTS'));
    this.logger.log('Getting possible high reward validator indexes');
    const propDependentRoot = await this.clClient.getDutyDependentRoot(headEpoch);
    const [sync, prop] = await Promise.all([
      this.clClient.getSyncCommitteeInfo('finalized', headEpoch),
      this.clClient.getCanonicalProposerDuties(headEpoch, propDependentRoot),
    ]);
    return [...new Set([...prop.map((v) => v.validator_index), ...sync.validators])];
  }

  @TrackTask('fill-epoch-metadata')
  protected async fillCurrentEpochMetadata(epoch: Epoch): Promise<any> {
    const meta = this.summary.epoch(epoch).getMeta();
    // const epochBlocks = range(epoch * 32, epoch * 32 + 31);
    meta.attestation = {
      participation: { source: 0n, target: 0n, head: 0n },
      blocks_rewards: new Map<number, bigint>(),
    };
    meta.sync.blocks_rewards = new Map<number, bigint>();
    // block can be with zero synchronization
    meta.sync.blocks_to_sync.forEach((b) => meta.sync.blocks_rewards.set(b, 0n));
    meta.sync.per_block_reward = Number(syncReward(meta.state.active_validators_total_increments, meta.state.base_reward));
    const perSyncProposerReward = (BigInt(meta.sync.per_block_reward) * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);
    for (const v of this.summary.epoch(epoch).values()) {
      const effectiveBalance = v.val_effective_balance ?? 0n;
      const increments = Number(effectiveBalance / BigInt(10 ** 9));
      const incBaseReward = increments * meta.state.base_reward;
      // Attestation participation calculated by previous epoch data
      // Attestation part of proposal reward should be calculated from previous and current epochs
      // Sync part of proposal reward should be calculated from current epoch
      const attested = this.summary.epoch(epoch - 1).get(v.val_id);
      if (attested?.att_happened) {
        let sourceFlagUp = false;
        let targetFlagUp = false;
        let headFlagUp = false;
        for (const [block, attestation] of attested.att_meta.entries()) {
          let rewards = meta.attestation.blocks_rewards.get(block) ?? 0n;
          if (!sourceFlagUp && attestation.timely_source) {
            meta.attestation.participation.source += BigInt(increments);
            rewards += BigInt(Math.trunc(incBaseReward * TIMELY_SOURCE_WEIGHT));
            sourceFlagUp = true;
          }
          if (!targetFlagUp && attestation.timely_target) {
            meta.attestation.participation.target += BigInt(increments);
            rewards += BigInt(Math.trunc(incBaseReward * TIMELY_TARGET_WEIGHT));
            targetFlagUp = true;
          }
          if (!headFlagUp && attestation.timely_head) {
            meta.attestation.participation.head += BigInt(increments);
            rewards += BigInt(Math.trunc(incBaseReward * TIMELY_HEAD_WEIGHT));
            headFlagUp = true;
          }
          meta.attestation.blocks_rewards.set(block, rewards);
        }
      }
      if (v.att_happened) {
        let sourceFlagUp = false;
        let targetFlagUp = false;
        let headFlagUp = false;
        for (const [block, attestation] of v.att_meta.entries()) {
          let rewards = meta.attestation.blocks_rewards.get(block) ?? 0n;
          if (!sourceFlagUp && attestation.timely_source) {
            rewards += BigInt(Math.trunc(incBaseReward * TIMELY_SOURCE_WEIGHT));
            sourceFlagUp = true;
          }
          if (!targetFlagUp && attestation.timely_target) {
            rewards += BigInt(Math.trunc(incBaseReward * TIMELY_TARGET_WEIGHT));
            targetFlagUp = true;
          }
          if (!headFlagUp && attestation.timely_head) {
            rewards += BigInt(Math.trunc(incBaseReward * TIMELY_HEAD_WEIGHT));
            headFlagUp = true;
          }
          meta.attestation.blocks_rewards.set(block, rewards);
        }
      }
      if (v.is_sync) {
        for (const block of v.sync_meta.synced_blocks) {
          meta.sync.blocks_rewards.set(block, meta.sync.blocks_rewards.get(block) + perSyncProposerReward);
        }
      }
    }
    this.summary.epoch(epoch).setMeta(meta);
  }

  protected async writeSummary(epoch: Epoch): Promise<any> {
    this.logger.log('Writing summary of duties into DB');
    await this.storage.writeSummary(this.summary.epoch(epoch).valuesToWrite());
  }

  protected async writeEpochMeta(epoch: Epoch): Promise<any> {
    this.logger.log('Writing epoch metadata into DB');
    const meta = this.summary.epoch(epoch).getMeta();
    await this.storage.writeEpochMeta(epoch, meta);
  }
}
