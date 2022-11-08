import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/eth-providers';
import { BlockCacheService } from 'common/eth-providers/consensus-provider/block-cache';
import { bigintRange } from 'common/functions/range';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { ClickhouseService } from 'storage';

import { AttestationService } from './attestation';
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
  ) {}

  public async checkAndWrite(epoch: bigint, stateSlot: bigint): Promise<any> {
    // Prefetch will be done before main checks because duty by state requests are heavy
    // and while we wait for their responses we fetch blocks and headers.
    // If for some reason prefetch task will be slower than duty by state requests,
    // blocks and headers will be fetched inside tasks of checks
    await Promise.all([this.prefetch(epoch), this.checkAll(epoch, stateSlot)]);
    await this.write();
  }

  @TrackTask('check-all-duties')
  protected async checkAll(epoch: bigint, stateSlot: bigint): Promise<any> {
    this.summary.clear();
    this.logger.log('Checking duties of validators');
    await Promise.all([
      this.state.check(epoch, stateSlot),
      this.attestation.check(epoch, stateSlot),
      this.sync.check(epoch, stateSlot),
      this.propose.check(epoch),
    ]);
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
      const chunk = toFetch.splice(0, 64);
      await Promise.all(chunk);
    }
  }

  protected async write(): Promise<any> {
    this.logger.log('Writing summary of duties into DB');
    await this.storage.writeSummary(this.summary.values());
    this.summary.clear();
  }
}
