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
    await Promise.all([this.writeEpochMeta(epoch), this.writeSummary()]);
    await this.storage.updateEpochProcessing({ epoch, is_stored: true });
    return possibleHighRewardVals;
  }

  @TrackTask('check-all-duties')
  protected async checkAll(epoch: Epoch, stateSlot: Slot): Promise<any> {
    this.summary.clear();
    this.summary.clearMeta();
    this.logger.log('Checking duties of validators');
    await Promise.all([
      this.state.check(epoch, stateSlot),
      this.attestation.check(epoch, stateSlot),
      this.sync.check(epoch, stateSlot),
      this.propose.check(epoch),
    ]);
    // must be done after all duties check
    await this.fillCurrentEpochMetadata();
    // calculate rewards after check all duties
    const prevEpochMetadata = await this.storage.getEpochMetadata(epoch - 1);
    await this.rewards.calculate(epoch, prevEpochMetadata);
  }

  @TrackTask('prefetch-slots')
  protected async prefetch(epoch: Epoch): Promise<any> {
    this.blockCacheService.purgeOld(epoch);
    this.logger.log('Prefetching blocks header, info and write to cache');
    const slotsInEpoch = this.config.get('FETCH_INTERVAL_SLOTS');
    const firstSlotInEpoch = epoch * slotsInEpoch;
    const slots: number[] = range(firstSlotInEpoch, firstSlotInEpoch + slotsInEpoch * 2);
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
  protected async fillCurrentEpochMetadata() {
    const meta = this.summary.getMeta();
    meta.attestation = {
      participation: { source: 0n, target: 0n, head: 0n },
      blocks_rewards: new Map<number, bigint>(),
    };
    meta.sync.blocks_rewards = new Map<number, bigint>();
    // block can be with zero synchronization
    meta.sync.blocks_to_sync.forEach((b) => meta.sync.blocks_rewards.set(b, 0n));
    meta.sync.per_block_reward = Number(syncReward(meta.state.active_validators_total_increments, meta.state.base_reward));
    const perSyncProposerReward = (BigInt(meta.sync.per_block_reward) * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);
    for (const v of this.summary.values()) {
      // todo: maybe data consistency checks are needed. e.g. attested validator must have an effective balance
      if (v.att_meta && v.att_meta.included_in_block) {
        let rewards = meta.attestation.blocks_rewards.get(v.att_meta.included_in_block) ?? 0n;
        const effectiveBalance = v.val_effective_balance ?? 0n;
        const increments = Number(effectiveBalance / BigInt(10 ** 9));
        const incBaseReward = increments * meta.state.base_reward;
        if (v.att_meta?.reward_per_increment.source != 0) {
          meta.attestation.participation.source += BigInt(increments);
          rewards += BigInt(Math.trunc(incBaseReward * v.att_meta.reward_per_increment.source));
        }
        if (v.att_meta?.reward_per_increment.target != 0) {
          meta.attestation.participation.target += BigInt(increments);
          rewards += BigInt(Math.trunc(incBaseReward * v.att_meta.reward_per_increment.target));
        }
        if (v.att_meta?.reward_per_increment.head != 0) {
          meta.attestation.participation.head += BigInt(increments);
          rewards += BigInt(Math.trunc(incBaseReward * v.att_meta.reward_per_increment.head));
        }
        meta.attestation.blocks_rewards.set(v.att_meta.included_in_block, rewards);
      }
      if (v.is_sync) {
        for (const block of v.sync_meta.synced_blocks) {
          meta.sync.blocks_rewards.set(block, meta.sync.blocks_rewards.get(block) + perSyncProposerReward);
        }
      }
    }
    this.summary.setMeta(meta);
  }

  protected async writeSummary(): Promise<any> {
    this.logger.log('Writing summary of duties into DB');
    await this.storage.writeSummary(this.summary.valuesToWrite());
    this.summary.clear();
  }

  protected async writeEpochMeta(epoch: Epoch): Promise<any> {
    this.logger.log('Writing epoch metadata into DB');
    const meta = this.summary.getMeta();
    await this.storage.writeEpochMeta(epoch, meta);
    this.summary.clearMeta();
  }
}
