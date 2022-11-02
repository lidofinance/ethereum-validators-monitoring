import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/eth-providers';
import { bigintRange } from 'common/functions/range';
import { PrometheusService } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { DutyService } from 'duty';
import { AttestationService } from 'duty/attestation';
import { ProposeService } from 'duty/propose';
import { StateService } from 'duty/state';
import { SyncService } from 'duty/sync';
import { ClickhouseService, ValidatorIdentifications, ValidatorsStatusStats } from 'storage/clickhouse';

@Injectable()
export class DataProcessingService implements OnModuleInit {
  public latestProcessedEpoch = 0n;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly storage: ClickhouseService,
    protected readonly registryService: RegistryService,
    protected readonly state: StateService,
    protected readonly attestation: AttestationService,
    protected readonly propose: ProposeService,
    protected readonly sync: SyncService,
    protected readonly duty: DutyService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.latestProcessedEpoch = await this.storage.getMaxEpoch();
    this.prometheus.epochTime = await this.clClient.getSlotTime(this.latestProcessedEpoch * 32n);
    this.prometheus.epochNumber.set(Number(this.latestProcessedEpoch));
  }

  public async prefetch(args): Promise<any> {
    this.logger.log('Prefetching blocks header, info and write to cache');
    const { epoch } = args;
    const slotsInEpoch = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    const firstSlotInEpoch = epoch * slotsInEpoch;
    const slots: bigint[] = bigintRange(firstSlotInEpoch, firstSlotInEpoch + slotsInEpoch * 2n);
    const toFetch = slots.map((s) => [this.clClient.getBlockHeader(s), this.clClient.getBlockInfo(s)]).flat();
    while (toFetch.length > 0) {
      const chunk = toFetch.splice(0, 64);
      await Promise.all(chunk);
    }
  }

  public async process(
    epoch: bigint,
    stateSlot: bigint,
  ): Promise<{ userIDs: ValidatorIdentifications[]; otherValidatorsCounts: ValidatorsStatusStats; otherAvgSyncPercent: number }> {
    return await this.prometheus.trackTask('process-write-finalized-data', async () => {
      try {
        const slotTime = await this.clClient.getSlotTime(epoch * BigInt(this.config.get('FETCH_INTERVAL_SLOTS')));
        const keysIndexed = await this.registryService.getActualKeysIndexed(Number(slotTime));
        await Promise.all([this.prefetch({ epoch }), this.duty.check({ epoch, stateSlot, keysIndexed })]);
        await this.duty.write();
        this.latestProcessedEpoch = epoch;
      } catch (e) {
        this.logger.error(`Error while processing and writing [${epoch}] epoch`);
        throw e;
      }
    });
  }
}
