import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';

import { CriticalAlertsService } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/eth-providers';
import { BlockCacheService } from 'common/eth-providers/consensus-provider/block-cache';
import { sleep } from 'common/functions/sleep';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { DutyMetrics, DutyService } from 'duty';
import { ClickhouseService } from 'storage';
import { EpochProcessingState } from 'storage/clickhouse';

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

    protected readonly dutyService: DutyService,
    protected readonly dutyMetrics: DutyMetrics,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.log(`Starting epoch [${this.config.get('START_EPOCH')}]`);
    const latestProcessedEpoch = await this.storage.getLastProcessedEpoch();
    this.prometheus.epochTime = await this.clClient.getSlotTime(latestProcessedEpoch.epoch * 32n);
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
          const { epoch, slot, is_stored, is_calculated } = toProcess;
          let possibleHighRewardValidators = [];
          if (!is_stored) {
            possibleHighRewardValidators = await this.dutyService.checkAndWrite(epoch, slot);
          }
          if (!is_calculated) {
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

  protected async getEpochDataToProcess(): Promise<EpochProcessingState & { slot: bigint }> {
    const chosen = await this.chooseEpochToProcess();
    const latestFinalizedBeaconBlock = <BlockHeaderResponse>await this.clClient.getBlockHeader('finalized');
    const latestFinalizedEpoch = BigInt(latestFinalizedBeaconBlock.header.message.slot) / 32n;
    if (latestFinalizedEpoch < chosen.epoch) {
      // new finalized epoch hasn't happened, from which we should get information about needed
      // just wait `CHAIN_SLOT_TIME_SECONDS` until finality happens
      const sleepTime = this.config.get('CHAIN_SLOT_TIME_SECONDS');
      this.logger.log(
        `Latest finalized epoch [${latestFinalizedEpoch}]. Waiting [${sleepTime}] seconds for next finalized epoch [${chosen.epoch}]`,
      );

      return new Promise((resolve) => {
        setTimeout(() => resolve(undefined), sleepTime * 1000);
      });
    }
    // new finalized slot has happened, from which we can get information about needed
    this.logger.log(`Latest finalized epoch [${latestFinalizedEpoch}]. Next epoch to process [${chosen.epoch}]`);
    const existedHeader = (await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(chosen.slot)).header.message;
    if (chosen.slot == BigInt(existedHeader.slot)) {
      this.logger.log(
        `Epoch [${chosen.epoch}] is chosen to process with state slot [${chosen.slot}] with root [${existedHeader.state_root}]`,
      );
    } else {
      this.logger.log(
        `Epoch [${chosen.epoch}] is chosen to process with state slot [${existedHeader.slot}] with root [${existedHeader.state_root}] ` +
          `instead of slot [${chosen.slot}]. Difference [${BigInt(existedHeader.slot) - chosen.slot}] slots`,
      );
    }

    return {
      ...chosen,
      slot: existedHeader.slot,
    };
  }

  @TrackTask('choose-epoch-to-process')
  protected async chooseEpochToProcess(): Promise<EpochProcessingState & { slot: bigint }> {
    const step = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    let next: EpochProcessingState = { epoch: BigInt(this.config.get('START_EPOCH')), is_stored: false, is_calculated: false };
    let lastProcessed = await this.storage.getLastProcessedEpoch();
    const last = await this.storage.getLastEpoch();
    if (last.epoch == 0n) {
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
      next.epoch = lastProcessed.epoch + 1n;
    }
    this.logger.log(`Next epoch to process [${next.epoch}]`);
    return { ...next, slot: next.epoch * step + (step - 1n) };
  }
}
