import { sleep } from 'common/functions/sleep';
import { DataProcessingService } from './processing/data-processing.service';
import { StatsProcessingService } from './processing/stats-processing.service';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';
import { ConsensusProviderService } from 'common/eth-providers';
import { ClickhouseService } from 'storage';
import { CriticalAlertsService } from 'common/alertmanager/critical-alerts.service';

@Injectable()
export class InspectorService implements OnModuleInit {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly storage: ClickhouseService,
    protected readonly dataProcessor: DataProcessingService,
    protected readonly statsProcessor: StatsProcessingService,
    protected readonly criticalAlertService: CriticalAlertsService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.log(`Starting slot [${this.config.get('START_SLOT')}]`);
  }

  public async startLoop(): Promise<never> {
    this.logger.log(`DRY RUN ${this.config.get('DRY_RUN') ? 'enabled' : 'disabled'}`);

    const version = await this.clClient.getVersion();
    this.logger.log(`Beacon chain API info [${version}]`);
    this.logger.log(
      `Calculated slot step [${this.config.get('FETCH_INTERVAL_SLOTS')}] based on $FETCH_INTERVAL_SECONDS / $CHAIN_SLOT_TIME_SECONDS`,
    );

    while (true) {
      try {
        // Calculate finalized data stats (validator balances, attestations, proposes and etc.)
        const nextFinalizedSlot = this.calculateNextFinalizedSlot();
        const { slotToWrite, stateRoot, slotNumber } = await this.waitForNextFinalizedSlot(nextFinalizedSlot);
        if (slotToWrite > 0) {
          const res = await this.dataProcessor.processAndWriteFinalizedData(slotToWrite, stateRoot, slotNumber);
          let possibleHighRewardValidators: string[] = [];
          if (res?.lidoIDs.length) {
            const headEpoch = await this.calculateHeadEpoch();
            possibleHighRewardValidators = await this.dataProcessor.getPossibleHighRewardValidatorIndexes(res.lidoIDs, headEpoch);
          }
          await this.statsProcessor.calculateLidoStats(slotToWrite, possibleHighRewardValidators);
          await this.statsProcessor.calculateOtherStats(res.otherCounts);
          await this.statsProcessor.finalizeAppIterate(slotToWrite);
          await this.criticalAlertService.sendCriticalAlerts(slotToWrite);
        }
      } catch (e) {
        this.logger.error('Error in main loop');
        this.logger.error(e as any);
      }

      if (this.config.get('DRY_RUN')) {
        await sleep(1000 * 3600 * 24); // wake up every 24 hours
        this.logger.log('DRY RUN enabled, waiting 24 hours for the next loop cycle');
      }
    }
  }

  public async close(): Promise<void> {
    this.logger.log(`Closing application`);
    await this.storage.close();
  }

  protected async waitForNextFinalizedSlot(nextSlot: bigint): Promise<{ slotToWrite: bigint; stateRoot: string; slotNumber: bigint }> {
    const latestFinalizedBeaconBlock = await this.clClient.getBeaconBlockHeader('finalized');

    if (latestFinalizedBeaconBlock.slotNumber >= nextSlot && nextSlot > this.dataProcessor.latestSlotInDb) {
      this.logger.log(
        `Latest finalized slot [${latestFinalizedBeaconBlock.slotNumber}] found. Next slot [${nextSlot}]. Latest DB slot [${this.dataProcessor.latestSlotInDb}]`,
      );

      const [nextFinalizedBeaconBlock, isMissed] = await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(nextSlot);

      if (!isMissed) {
        this.logger.log(
          `Fetched next slot [${nextFinalizedBeaconBlock.slotNumber}] with state root [${nextFinalizedBeaconBlock.stateRoot}]`,
        );

        return {
          slotToWrite: nextFinalizedBeaconBlock.slotNumber,
          stateRoot: nextFinalizedBeaconBlock.stateRoot,
          slotNumber: nextFinalizedBeaconBlock.slotNumber,
        };
      }

      this.logger.log(
        `Fetched next slot [${nextFinalizedBeaconBlock.slotNumber}] with state root [${
          nextFinalizedBeaconBlock.stateRoot
        }] instead of slot [${nextSlot}]. Difference [${nextFinalizedBeaconBlock.slotNumber - nextSlot}] slots`,
      );

      return {
        slotToWrite: nextSlot,
        stateRoot: nextFinalizedBeaconBlock.stateRoot,
        slotNumber: nextFinalizedBeaconBlock.slotNumber,
      };
    }

    const sleepTime = this.getSleepTimeForNextSlot(nextSlot, latestFinalizedBeaconBlock.slotNumber);
    this.logger.log(
      `Latest finalized slot [${latestFinalizedBeaconBlock.slotNumber}] found. Latest DB slot [${this.dataProcessor.latestSlotInDb}]. Waiting [${sleepTime}] seconds for next slot [${nextSlot}]`,
    );

    return new Promise((resolve) => {
      setTimeout(() => resolve({ slotToWrite: 0n, stateRoot: '', slotNumber: 0n }), sleepTime * 1000);
    });
  }

  protected calculateNextFinalizedSlot(): bigint {
    const step = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    const startingSlot =
      this.dataProcessor.latestSlotInDb >= BigInt(this.config.get('START_SLOT'))
        ? this.dataProcessor.latestSlotInDb
        : BigInt(this.config.get('START_SLOT'));

    this.logger.log(`Starting slot [${startingSlot}]`);

    const epoch = startingSlot / step;
    const latestSlotInEpoch = epoch * step + (step - 1n);

    this.logger.log(`Starting slot (end of epoch [${epoch}]). Recalculated [${latestSlotInEpoch}]`);

    return latestSlotInEpoch == startingSlot ? latestSlotInEpoch + step : latestSlotInEpoch;
  }

  protected getSleepTimeForNextSlot(nextSlot: bigint, latestFinalizedSlot: bigint): number {
    let sleepTime =
      Math.abs(Number(nextSlot - latestFinalizedSlot)) * this.config.get('CHAIN_SLOT_TIME_SECONDS') +
      this.config.get('CHAIN_SLOT_TIME_SECONDS');

    if (sleepTime > 400) {
      sleepTime = 10;
    }

    return sleepTime;
  }

  protected async calculateHeadEpoch(): Promise<bigint> {
    const actualSlotHeader = await this.clClient.getBeaconBlockHeader('head');
    return actualSlotHeader.slotNumber / BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
  }
}
