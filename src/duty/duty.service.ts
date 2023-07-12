import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService, WorkingMode } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/consensus-provider';
import { BlockCacheService } from 'common/consensus-provider/block-cache';
import { Epoch, Slot } from 'common/consensus-provider/types';
import { allSettled } from 'common/functions/allSettled';
import { range } from 'common/functions/range';
import { unblock } from 'common/functions/unblock';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { ClickhouseService } from 'storage';

import { AttestationService } from './attestation';
import { TIMELY_HEAD_WEIGHT, TIMELY_SOURCE_WEIGHT, TIMELY_TARGET_WEIGHT } from './attestation/attestation.constants';
import { DutyRewards } from './duty.rewards';
import { ProposeService } from './propose';
import { PROPOSER_WEIGHT, WEIGHT_DENOMINATOR, proposerAttPartReward } from './propose/propose.constants';
import { StateService } from './state';
import { SummaryService } from './summary';
import { SyncService } from './sync';
import { syncReward } from './sync/sync.constants';
import { WithdrawalsService } from './withdrawal';

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
    protected readonly withdrawals: WithdrawalsService,
  ) {}

  public async checkAndWrite({ epoch, stateSlot }: { epoch: Epoch; stateSlot: Slot }): Promise<string[]> {
    const workingMode = this.config.get('WORKING_MODE');
    const [, , possibleHighRewardVals] = await allSettled([
      // Prefetch will be done before main checks because duty by state requests are heavy
      // and while we wait for their responses we fetch blocks and headers.
      // If for some reason prefetch task will be slower than duty by state requests,
      // blocks and headers will be fetched inside tasks of checks
      // so, it can be optional when failed
      this.prefetch(epoch).catch(() => undefined),
      this.checkAll(epoch, stateSlot),
      // Optional task to get possible high reward validators for head epoch
      // it's nice to have but not critical
      workingMode == WorkingMode.Finalized ? this.getPossibleHighRewardValidators().catch(() => []) : [],
    ]);
    await allSettled([this.writeEpochMeta(epoch), this.writeSummary(epoch)]);
    this.summary.clear();
    await this.storage.updateEpochProcessing({ epoch, is_stored: true });
    return possibleHighRewardVals;
  }

  @TrackTask('check-all-duties')
  protected async checkAll(epoch: Epoch, stateSlot: Slot): Promise<any> {
    this.summary.clear();
    this.logger.log('Checking duties of validators');
    await allSettled([
      this.state.check(epoch, stateSlot),
      this.attestation.check(epoch, stateSlot),
      this.sync.check(epoch, stateSlot),
      this.propose.check(epoch),
      this.withdrawals.check(epoch),
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
      await allSettled(chunk);
    }
  }

  @TrackTask('high-reward-validators')
  public async getPossibleHighRewardValidators(): Promise<string[]> {
    const actualSlotHeader = <BlockHeaderResponse>await this.clClient.getBlockHeader('head');
    const headEpoch = Math.trunc(actualSlotHeader.header.message.slot / this.config.get('FETCH_INTERVAL_SLOTS'));
    this.logger.log('Getting possible high reward validator indexes');
    const [sync, prop] = await allSettled([
      this.clClient.getSyncCommitteeInfo('finalized', headEpoch),
      this.clClient.getCanonicalProposerDuties(headEpoch, 3, true),
    ]);
    return [...new Set([...prop.map((v) => v.validator_index), ...sync.validators])];
  }

  @TrackTask('fill-epoch-metadata')
  protected async fillCurrentEpochMetadata(epoch: Epoch): Promise<any> {
    await this.fillAttestationAndSyncMetadata(epoch);
    await this.fillProposalRewardsMetadata(epoch);
  }

  @TrackTask('fill-att-sync-epoch-metadata')
  protected async fillAttestationAndSyncMetadata(epoch: Epoch): Promise<any> {
    const meta = this.summary.epoch(epoch).getMeta();
    meta.sync.per_block_reward = Number(syncReward(meta.state.active_validators_total_increments, meta.state.base_reward));
    const perSyncProposerReward = Math.floor((meta.sync.per_block_reward * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT));
    const maxBatchSize = 1000;
    let index = 0;
    for (const v of this.summary.epoch(epoch).values()) {
      const effectiveBalance = v.val_effective_balance;
      const increments = Number(effectiveBalance / BigInt(10 ** 9));
      // Attestation participation calculated by previous epoch data
      // Sync part of proposal reward should be calculated from current epoch
      const attested = this.summary.epoch(epoch - 1).get(v.val_id);
      if (!v.val_slashed && attested?.att_happened) {
        if (attested.att_valid_source) {
          meta.attestation.participation.source += BigInt(increments);
        }
        if (attested.att_valid_target) {
          meta.attestation.participation.target += BigInt(increments);
        }
        if (attested.att_valid_head) {
          meta.attestation.participation.head += BigInt(increments);
        }
      }
      if (v.is_sync) {
        for (const block of v.sync_meta.synced_blocks) {
          meta.sync.blocks_rewards.set(block, meta.sync.blocks_rewards.get(block) + BigInt(perSyncProposerReward));
        }
      }
      index++;
      if (index % maxBatchSize == 0) {
        await unblock();
      }
    }
    this.summary.epoch(epoch).setMeta(meta);
  }

  @TrackTask('fill-prop-reward-epoch-metadata')
  protected async fillProposalRewardsMetadata(epoch: Epoch): Promise<any> {
    const meta = this.summary.epoch(epoch).getMeta();
    for (const [block, attestations] of meta.attestation.blocks_attestations.entries()) {
      // There is only one right way to calculate proposal reward - calculate it from each aggregated attestation
      // And attestation flag should be included for the first time. `AttestationService.processAttestation` is responsible for this
      if (!attestations.length) continue;
      for (const attestation of attestations) {
        let rewards = 0;
        for (const index of attestation.source) {
          const effectiveBalance = this.summary.epoch(epoch).get(index)?.val_effective_balance;
          const increments = Number(effectiveBalance / BigInt(10 ** 9));
          const incBaseReward = increments * meta.state.base_reward;
          rewards += incBaseReward * TIMELY_SOURCE_WEIGHT;
        }
        for (const index of attestation.target) {
          const effectiveBalance = this.summary.epoch(epoch).get(index)?.val_effective_balance;
          const increments = Number(effectiveBalance / BigInt(10 ** 9));
          const incBaseReward = increments * meta.state.base_reward;
          rewards += incBaseReward * TIMELY_TARGET_WEIGHT;
        }
        for (const index of attestation.head) {
          const effectiveBalance = this.summary.epoch(epoch).get(index)?.val_effective_balance;
          const increments = Number(effectiveBalance / BigInt(10 ** 9));
          const incBaseReward = increments * meta.state.base_reward;
          rewards += incBaseReward * TIMELY_HEAD_WEIGHT;
        }
        rewards = Math.floor(proposerAttPartReward(rewards));
        meta.attestation.blocks_rewards.set(block, meta.attestation.blocks_rewards.get(block) + BigInt(rewards));
        await unblock();
      }
    }
    this.summary.epoch(epoch).setMeta(meta);
  }

  protected async writeSummary(epoch: Epoch): Promise<any> {
    this.logger.log('Writing summary of duties into DB');
    await this.storage.writeSummary(this.summary.epoch(epoch).values());
  }

  protected async writeEpochMeta(epoch: Epoch): Promise<any> {
    this.logger.log('Writing epoch metadata into DB');
    const meta = this.summary.epoch(epoch).getMeta();
    await this.storage.writeEpochMeta(epoch, meta);
  }
}
