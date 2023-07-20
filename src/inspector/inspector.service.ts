import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';

import { CriticalAlertsService } from 'common/alertmanager';
import { ConfigService, WorkingMode } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/consensus-provider';
import { BlockCacheService } from 'common/consensus-provider/block-cache';
import { Slot } from 'common/consensus-provider/types';
import { sleep } from 'common/functions/sleep';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { DutyMetrics, DutyService } from 'duty';
import { ClickhouseService } from 'storage';
import { EpochProcessingState } from 'storage/clickhouse';
import { RegistryService } from 'validators-registry';

@Injectable()
export class InspectorService implements OnModuleInit {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly storage: ClickhouseService,
    protected readonly prometheus: PrometheusService,
    protected readonly criticalAlerts: CriticalAlertsService,
    protected readonly blockCacheService: BlockCacheService,
    protected readonly registryService: RegistryService,

    protected readonly dutyService: DutyService,
    protected readonly dutyMetrics: DutyMetrics,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.log(`Starting epoch [${this.config.get('START_EPOCH')}]`);
    const latestProcessedEpoch = await this.storage.getLastProcessedEpoch();
    this.prometheus.epochTime = await this.clClient.getSlotTime(latestProcessedEpoch.epoch * 32);
    this.prometheus.epochNumber.set(Number(latestProcessedEpoch.epoch));
  }

  public async startLoop(): Promise<never> {
    const version = await this.clClient.getVersion();
    this.logger.log(`Beacon chain API info [${version}]`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const toProcess = await this.getEpochDataToProcess();
        if (toProcess) {
          if (this.config.get('WORKING_MODE') == WorkingMode.Head) {
            this.logger.warn(`Working in HEAD mode. This can cause calculation errors and inaccurate data!`);
          }
          const { epoch, slot, is_stored, is_calculated } = toProcess;
          let possibleHighRewardValidators = [];
          if (!is_stored) {
            possibleHighRewardValidators = await this.dutyService.checkAndWrite({ epoch: epoch, stateSlot: slot });
          }
          if (!is_calculated) {
            if (!this.registryService.isFilled()) {
              const slotTime = await this.clClient.getSlotTime(epoch * this.config.get('FETCH_INTERVAL_SLOTS'));
              await this.registryService.updateKeysRegistry(slotTime);
            }
            await this.dutyMetrics.calculate(epoch, possibleHighRewardValidators);
          }
          await this.criticalAlerts.send(epoch);
        }
      } catch (e) {
        this.logger.error(`Error while processing and writing epoch`);
        this.logger.error(e as any);
        // Remove the cache because there may be an error due to bad node responses
        this.blockCacheService.clear();
        // We should make a gap before running new circle. This will avoid requests and logs spam
        await sleep(this.config.get('CHAIN_SLOT_TIME_SECONDS') * 1000);
      }

      if (this.config.get('DRY_RUN')) {
        await sleep(1000 * 3600 * 24); // wake up every 24 hours
        this.logger.log('DRY RUN enabled, waiting 24 hours for the next loop cycle');
      }
    }
  }

  protected async getEpochDataToProcess(): Promise<EpochProcessingState & { slot: Slot }> {
    const chosen = await this.chooseEpochToProcess();
    const latestBeaconBlock = Number((<BlockHeaderResponse>await this.clClient.getLatestBlockHeader(chosen)).header.message.slot);
    let latestEpoch = Math.trunc(latestBeaconBlock / this.config.get('FETCH_INTERVAL_SLOTS'));
    if (latestEpoch * this.config.get('FETCH_INTERVAL_SLOTS') == latestBeaconBlock) {
      // if it's the first slot of epoch, it makes checkpoint for previous epoch
      latestEpoch -= 1;
    }
    if (chosen.slot > latestBeaconBlock) {
      // new latest slot hasn't happened, from which parent we can get information about needed state
      // just wait `CHAIN_SLOT_TIME_SECONDS` until new slot happens
      const sleepTime = this.config.get('CHAIN_SLOT_TIME_SECONDS');
      this.logger.log(`Latest epoch [${latestEpoch}]. Waiting [${sleepTime}] seconds for the end of epoch [${chosen.epoch}]`);

      return new Promise((resolve) => {
        setTimeout(() => resolve(undefined), sleepTime * 1000);
      });
    }
    // new epoch has happened, from which parent we can get information about needed state
    const existedHeader = (await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(chosen.slot)).header.message;
    this.logger.log(`Latest epoch [${latestEpoch}]. Next epoch to process [${chosen.epoch}]`);
    if (chosen.slot == Number(existedHeader.slot)) {
      this.logger.log(
        `Epoch [${chosen.epoch}] is chosen to process with state slot [${chosen.slot}] with root [${existedHeader.state_root}]`,
      );
    } else {
      this.logger.log(
        `Epoch [${chosen.epoch}] is chosen to process with state slot [${existedHeader.slot}] with root [${existedHeader.state_root}] ` +
          `instead of slot [${chosen.slot}]. Difference [${Number(existedHeader.slot) - chosen.slot}] slots`,
      );
    }

    return {
      ...chosen,
      slot: Number(existedHeader.slot),
    };
  }

  @TrackTask('choose-epoch-to-process')
  protected async chooseEpochToProcess(): Promise<EpochProcessingState & { slot: Slot }> {
    const step = this.config.get('FETCH_INTERVAL_SLOTS');
    let next: EpochProcessingState = { epoch: this.config.get('START_EPOCH'), is_stored: false, is_calculated: false };
    let lastProcessed = await this.storage.getLastProcessedEpoch();
    const last = await this.storage.getLastEpoch();
    if (last.epoch == 0) {
      // if it's first time, we should get max stored in summary table
      const max = await this.storage.getMaxEpoch();
      lastProcessed = { epoch: max.max, is_stored: true, is_calculated: true };
    }
    this.logger.log(`Last processed epoch [${lastProcessed.epoch}]`);
    if ((last.is_stored && !last.is_calculated) || (!last.is_stored && last.is_calculated)) {
      this.logger.debug(JSON.stringify(last));
      this.logger.warn(`Epoch [${last.epoch}] processing was not completed correctly. Trying to complete`);
      next = last;
    }
    if (lastProcessed.epoch >= next.epoch) {
      next.epoch = lastProcessed.epoch + 1;
    }
    this.logger.log(`Next epoch to process [${next.epoch}]`);
    return { ...next, slot: next.epoch * step + (step - 1) };
  }
}
