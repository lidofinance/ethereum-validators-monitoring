import { sleep } from 'common/functions/sleep';
import { DataProcessingService } from './processing/data-processing.service';
import { StatsProcessingService } from './processing/stats-processing.service';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService, SlotsCacheService } from 'common/eth-providers';
import { ClickhouseService } from 'storage';
import { CriticalAlertsService } from 'common/alertmanager/critical-alerts.service';

@Injectable()
export class InspectorService implements OnModuleInit {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly storage: ClickhouseService,
    protected readonly dataProcessor: DataProcessingService,
    protected readonly statsProcessor: StatsProcessingService,
    protected readonly criticalAlertService: CriticalAlertsService,
    protected readonly slotsCacheService: SlotsCacheService,
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
        this.slotsCacheService.purgeOld(nextFinalizedSlot / BigInt(this.config.get('FETCH_INTERVAL_SLOTS')));
        const { slotToWrite, stateRoot, slotNumber } = await this.waitForNextFinalizedSlot(nextFinalizedSlot);
        if (slotToWrite > 0) {
          const res = await this.dataProcessor.processAndWriteFinalizedData(slotToWrite, stateRoot, slotNumber);
          let possibleHighRewardValidators: string[] = [];
          if (res?.userIDs.length) {
            const headEpoch = await this.calculateHeadEpoch();
            possibleHighRewardValidators = await this.dataProcessor.getPossibleHighRewardValidatorIndexes(res.userIDs, headEpoch);
          }
          await this.statsProcessor.calculateUserStats(slotToWrite, possibleHighRewardValidators);
          await this.statsProcessor.calculateOtherStats(res.otherValidatorsCounts, res.otherAvgSyncPercent);
          await this.statsProcessor.finalizeAppIterate(slotToWrite);
          await this.criticalAlertService.sendCriticalAlerts(slotToWrite);
        }
      } catch (e) {
        this.logger.error('Error in main loop');
        this.logger.error(e as any);
        // We should make a gap before running new circle. This will avoid requests and logs spam
        await sleep(this.config.get('CHAIN_SLOT_TIME_SECONDS') * 1000);
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
    const latestFinalizedBeaconBlock = <BlockHeaderResponse>await this.clClient.getBeaconBlockHeader('finalized');
    if (BigInt(latestFinalizedBeaconBlock.header.message.slot) < nextSlot) {
      // if new finalized slot hasn't happened, from which we should get information about needed
      // for example: latestSlotInDb = 32, nextSlot = 64, latestFinalizedBeaconBlock = 33
      // just wait `CHAIN_SLOT_TIME_SECONDS` until finality happens
      const sleepTime = this.config.get('CHAIN_SLOT_TIME_SECONDS');
      this.logger.log(
        `Latest finalized slot [${latestFinalizedBeaconBlock.header.message.slot}] found. Latest DB slot [${this.dataProcessor.latestSlotInDb}]. Waiting [${sleepTime}] seconds for next finalized slot [${nextSlot}]`,
      );

      return new Promise((resolve) => {
        setTimeout(() => resolve({ slotToWrite: 0n, stateRoot: '', slotNumber: 0n }), sleepTime * 1000);
      });
    }
    // if new finalized slot has happened, from which we can get information about needed
    // for example: latestSlotInDb = 32, nextSlot = 64, latestFinalizedBeaconBlock = 65
    this.logger.log(
      `Latest finalized slot [${latestFinalizedBeaconBlock.header.message.slot}] found. Next slot [${nextSlot}]. Latest DB slot [${this.dataProcessor.latestSlotInDb}]`,
    );

    // try to get block 64 header
    const finalizedBeaconBlockHeader = await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(nextSlot);

    if (nextSlot == BigInt(finalizedBeaconBlockHeader.header.message.slot)) {
      this.logger.log(`Fetched next slot [${nextSlot}] with state root [${finalizedBeaconBlockHeader.header.message.state_root}]`);
    } else {
      this.logger.log(
        `Fetched next slot [${finalizedBeaconBlockHeader.header.message.slot}] with state root [${
          finalizedBeaconBlockHeader.header.message.state_root
        }] instead of slot [${nextSlot}]. Difference [${BigInt(finalizedBeaconBlockHeader.header.message.slot) - nextSlot}] slots`,
      );
    }

    // if it's not missed - just return it
    // if it's missed that we return the closest finalized block stateRoot and slotNumber in epoch (for example - block 63)
    return {
      slotToWrite: nextSlot,
      stateRoot: finalizedBeaconBlockHeader.header.message.state_root,
      slotNumber: BigInt(finalizedBeaconBlockHeader.header.message.slot),
    };
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

  protected async calculateHeadEpoch(): Promise<bigint> {
    const actualSlotHeader = <BlockHeaderResponse>await this.clClient.getBeaconBlockHeader('head');
    return BigInt(actualSlotHeader.header.message.slot) / BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
  }
}
