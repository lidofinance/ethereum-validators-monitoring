import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';

import { CriticalAlertsService } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/eth-providers';
import { BlockCacheService } from 'common/eth-providers/consensus-provider/block-cache';
import { sleep } from 'common/functions/sleep';
import { ClickhouseService } from 'storage';

import { SummaryService } from '../duty/summary';
import { DataProcessingService } from './processing/data-processing.service';
import { StatsProcessingService } from './processing/stats-processing.service';

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
    protected readonly blockCacheService: BlockCacheService,
    protected readonly summary: SummaryService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.log(`Starting slot [${this.config.get('START_SLOT')}]`);
  }

  public async startLoop(): Promise<never> {
    const version = await this.clClient.getVersion();
    this.logger.log(`Beacon chain API info [${version}]`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // Calculate finalized data stats (validator balances, attestations, proposes and etc.)

        this.summary.clear(); // todo: move to another place
        const nextFinalizedSlot = this.calculateNextFinalizedSlot();
        const { epoch, stateSlot } = await this.waitForNextFinalizedSlot(nextFinalizedSlot);
        this.blockCacheService.purgeOld(epoch);
        const headEpoch = await this.calculateHeadEpoch();
        if (epoch > 0) {
          await this.dataProcessor.process(epoch, stateSlot);
          const possibleHighRewardValidators = await this.dataProcessor.getPossibleHighRewardValidators(headEpoch);
          await this.statsProcessor.calculateUserStats(epoch, possibleHighRewardValidators);
          await this.statsProcessor.calculateOtherStats(epoch);
          await this.statsProcessor.finalizeAppIterate(epoch);
          await this.criticalAlertService.sendCriticalAlerts(epoch);
        }
      } catch (e) {
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

  protected async waitForNextFinalizedSlot(nextSlot: bigint): Promise<{ epoch: bigint; stateSlot: bigint }> {
    const latestFinalizedBeaconBlock = <BlockHeaderResponse>await this.clClient.getBlockHeader('finalized');
    const latestFinalizedEpoch = BigInt(latestFinalizedBeaconBlock.header.message.slot) / 32n;
    if (BigInt(latestFinalizedBeaconBlock.header.message.slot) < nextSlot) {
      // if new finalized slot hasn't happened, from which we should get information about needed
      // for example: latestSlotInDb = 32, nextSlot = 64, latestFinalizedBeaconBlock = 33
      // just wait `CHAIN_SLOT_TIME_SECONDS` until finality happens
      const sleepTime = this.config.get('CHAIN_SLOT_TIME_SECONDS');
      this.logger.log(
        `Latest finalized epoch [${latestFinalizedEpoch}] found. Latest DB epoch [${this.dataProcessor.latestProcessedEpoch}]. Waiting [${sleepTime}] seconds for next finalized slot [${nextSlot}]`,
      );

      return new Promise((resolve) => {
        setTimeout(() => resolve({ epoch: 0n, stateSlot: 0n }), sleepTime * 1000);
      });
    }
    // if new finalized slot has happened, from which we can get information about needed
    // for example: latestSlotInDb = 32, nextSlot = 64, latestFinalizedBeaconBlock = 65
    this.logger.log(
      `Latest finalized epoch [${latestFinalizedEpoch}] found. Next slot [${nextSlot}]. Latest DB epoch [${this.dataProcessor.latestProcessedEpoch}]`,
    );

    // try to get block 64 header
    const nextProcessedEpoch = nextSlot / 32n;
    const nextProcessedHeader = await this.clClient.getBeaconBlockHeaderOrPreviousIfMissed(nextSlot);
    if (nextSlot == BigInt(nextProcessedHeader.header.message.slot)) {
      this.logger.log(
        `Fetched next epoch [${nextProcessedEpoch}] by slot [${nextSlot}] with state root [${nextProcessedHeader.header.message.state_root}]`,
      );
    } else {
      this.logger.log(
        `Fetched next epoch [${nextProcessedEpoch}] by slot [${nextProcessedHeader.header.message.slot}] with state root [${
          nextProcessedHeader.header.message.state_root
        }] instead of slot [${nextSlot}]. Difference [${BigInt(nextProcessedHeader.header.message.slot) - nextSlot}] slots`,
      );
    }

    // if it's not missed - just return it
    // if it's missed that we return the closest finalized block stateRoot and slotNumber in epoch (for example - block 63)
    return {
      epoch: nextProcessedEpoch,
      stateSlot: nextProcessedHeader.header.message.slot,
    };
  }

  protected calculateNextFinalizedSlot(): bigint {
    const step = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    let startEpoch = BigInt(this.config.get('START_EPOCH'));
    if (this.dataProcessor.latestProcessedEpoch >= startEpoch) {
      startEpoch = this.dataProcessor.latestProcessedEpoch + 1n;
    }
    const slotToProcess = startEpoch * step + (step - 1n); // latest slot in epoch
    this.logger.log(`Slot to process [${slotToProcess}] (end of epoch [${startEpoch}])`);
    return slotToProcess;
  }

  protected async calculateHeadEpoch(): Promise<bigint> {
    const actualSlotHeader = <BlockHeaderResponse>await this.clClient.getBlockHeader('head');
    return BigInt(actualSlotHeader.header.message.slot) / BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
  }
}
