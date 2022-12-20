import { Readable } from 'stream';

import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/eth-providers';
import { BlockCacheService } from 'common/eth-providers/consensus-provider/block-cache';
import { bigintRange } from 'common/functions/range';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { ClickhouseService } from 'storage';

import { AttestationService } from './attestation';
import { DutyRewards } from './duty.rewards';
import { ProposeService } from './propose';
import { StateService } from './state';
import { SummaryService } from './summary';
import { SyncService } from './sync';

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

  public async checkAndWrite(epoch: bigint, stateSlot: bigint): Promise<string[]> {
    // Prefetch will be done before main checks because duty by state requests are heavy
    // and while we wait for their responses we fetch blocks and headers.
    // If for some reason prefetch task will be slower than duty by state requests,
    // blocks and headers will be fetched inside tasks of checks
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [a, b, possibleHighRewardVals] = await Promise.all([
      this.prefetch(epoch),
      this.checkAll(epoch, stateSlot),
      this.getPossibleHighRewardValidators(),
    ]);
    await this.writeSummary();
    await this.writeEpochMeta(epoch);
    return possibleHighRewardVals;
  }

  @TrackTask('check-all-duties')
  protected async checkAll(epoch: bigint, stateSlot: bigint): Promise<any> {
    this.summary.clear();
    this.summary.clearMeta();
    this.logger.log('Checking duties of validators');
    await Promise.all([
      this.state.check(epoch, stateSlot),
      this.attestation.check(epoch, stateSlot),
      this.sync.check(epoch, stateSlot),
      this.propose.check(epoch),
    ]);
    // calculate rewards after check all duties
    await this.rewards.calculate(epoch);
  }

  @TrackTask('prefetch-slots')
  protected async prefetch(epoch: bigint): Promise<any> {
    this.blockCacheService.purgeOld(epoch);
    this.logger.log('Prefetching blocks header, info and write to cache');
    const slotsInEpoch = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    const firstSlotInEpoch = epoch * slotsInEpoch;
    const slots: bigint[] = bigintRange(firstSlotInEpoch, firstSlotInEpoch + slotsInEpoch * 2n);
    const toFetch = slots.map((s) => [this.clClient.getBlockHeader(s), this.clClient.getBlockInfo(s)]).flat();
    while (toFetch.length > 0) {
      const chunk = toFetch.splice(0, 32);
      await Promise.all(chunk);
    }
  }

  @TrackTask('high-reward-validators')
  public async getPossibleHighRewardValidators(): Promise<string[]> {
    const actualSlotHeader = <BlockHeaderResponse>await this.clClient.getBlockHeader('head');
    const headEpoch = BigInt(actualSlotHeader.header.message.slot) / BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    this.logger.log('Getting possible high reward validator indexes');
    const propDependentRoot = await this.clClient.getDutyDependentRoot(headEpoch);
    const [sync, prop] = await Promise.all([
      this.clClient.getSyncCommitteeInfo('finalized', headEpoch),
      this.clClient.getCanonicalProposerDuties(headEpoch, propDependentRoot),
    ]);
    return [...new Set([...prop.map((v) => v.validator_index), ...sync.validators])];
  }

  protected async writeSummary(): Promise<any> {
    this.logger.log('Writing summary of duties into DB');
    const stream = new Readable({ objectMode: true });
    await Promise.all([this.storage.writeSummary(stream), this.streamSummary(stream)]);
    this.summary.clear();
  }

  protected async writeEpochMeta(epoch: bigint): Promise<any> {
    this.logger.log('Writing epoch metadata into DB');
    await this.storage.writeEpochMeta(epoch, this.summary.getMeta());
    this.summary.clearMeta();
  }

  protected async streamSummary(stream: Readable) {
    const summary = this.summary.values();
    let next = summary.next();
    while (!next.done) {
      stream.push({ ...next.value, att_meta: undefined, sync_meta: undefined });
      next = summary.next();
    }
    stream.push(null);
  }
}
