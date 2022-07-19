import { inject, injectable, postConstruct } from 'inversify';
import { ILogger }                           from '../logger/ILogger';
import { Environment }                       from '../environment/Environment';
import { Eth2Client }                        from '../lighthouse/Eth2Client';
import { ClickhouseStorage }                 from '../storage/ClickhouseStorage';
import { sleep }                             from '../common/functions/sleep';
import { DataProcessor }                     from './DataProcessing';
import { StatsProcessor }                    from './StatsProcessing';
import { IHttpServer }                       from '../HttpServer/IHttpServer';

@injectable()
export class App {

  public constructor(
    @inject(ILogger) protected logger: ILogger,
    @inject(IHttpServer) protected httpServer: IHttpServer,
    @inject(Environment) protected env: Environment,
    @inject(Eth2Client) protected lighthouse: Eth2Client,
    @inject(ClickhouseStorage) protected storage: ClickhouseStorage,
    @inject(DataProcessor) protected dataProcessor: DataProcessor,
    @inject(StatsProcessor) protected statsProcessor: StatsProcessor
  ) {
  }

  @postConstruct()
  public async initialize(): Promise<void> {
    this.logger.info('Starting slot [%d]', this.env.START_SLOT);
  }

  public async startLoop(): Promise<never> {
    this.logger.info(`DRY RUN ${this.env.DRY_RUN ? 'enabled' : 'disabled'}`);

    const version = await this.lighthouse.getVersion();
    this.logger.info(`Beacon chain API info [${version}]`);
    this.logger.info(
      `Calculated slot step [${this.env.FETCH_INTERVAL_SLOTS}] based on $FETCH_INTERVAL_SECONDS / $CHAIN_SLOT_TIME_SECONDS`
    );

    while (true) {
      try {
        // Calculate finalized data stats (validator balances, attestations, proposes and etc.)
        const nextFinalizedSlot = this.calculateNextFinalizedSlot();
        const { slotToWrite, stateRoot, slotNumber } = await this.waitForNextFinalizedSlot(nextFinalizedSlot);
        if (slotToWrite > 0) {
          const res = await this.dataProcessor.processAndWriteFinalizedData(slotToWrite, stateRoot, slotNumber);
          if (res?.lidoIDs.length) {
            const headEpoch = await this.calculateHeadEpoch();
            const possibleHighRewardValidators = await this.dataProcessor.getPossibleHighRewardValidatorIndexes(res.lidoIDs, headEpoch);
            await this.statsProcessor.calculateLidoStats(slotToWrite, possibleHighRewardValidators);
            await this.statsProcessor.calculateOtherStats(res.otherCounts);
            await this.statsProcessor.finalizeAppIterate(slotToWrite);
          }
        }
      } catch (e) {
        this.logger.error('Error in main loop');
        this.logger.error(e as any);
      }

      if (this.env.DRY_RUN) {
        await sleep(1000 * 3600 * 24); // wake up every 24 hours
        this.logger.info('DRY RUN enabled, waiting 24 hours for the next loop cycle');
      }
    }
  }

  public async close(): Promise<void> {
    this.logger.info(`Closing application`);
    await this.storage.close();
  }

  protected async waitForNextFinalizedSlot(nextSlot: bigint): Promise<{ slotToWrite: bigint; stateRoot: string; slotNumber: bigint }> {
    const latestFinalizedBeaconBlock = await this.lighthouse.getBeaconBlockHeader('finalized');

    if (latestFinalizedBeaconBlock.slotNumber >= nextSlot && nextSlot > this.dataProcessor.latestSlotInDb) {
      this.logger.info('Latest finalized slot [%d] found. Next slot [%d]. Latest DB slot [%d]',
        latestFinalizedBeaconBlock.slotNumber, nextSlot, this.dataProcessor.latestSlotInDb);

      const [nextFinalizedBeaconBlock, isMissed] = await this.lighthouse.getBeaconBlockHeaderOrPreviousIfMissed(nextSlot);

      if (!isMissed) {
        this.logger.info('Fetched next slot [%d] with state root [%s]',
          nextFinalizedBeaconBlock.slotNumber, nextFinalizedBeaconBlock.stateRoot);

        return {
          slotToWrite: nextFinalizedBeaconBlock.slotNumber,
          stateRoot: nextFinalizedBeaconBlock.stateRoot,
          slotNumber: nextFinalizedBeaconBlock.slotNumber,
        };
      }

      this.logger.info('Fetched next slot [%d] with state root [%s] instead of slot [%d]. Difference [%d] slots',
        nextFinalizedBeaconBlock.slotNumber, nextFinalizedBeaconBlock.stateRoot, nextSlot, nextFinalizedBeaconBlock.slotNumber - nextSlot);

      return {
        slotToWrite: nextSlot,
        stateRoot: nextFinalizedBeaconBlock.stateRoot,
        slotNumber: nextFinalizedBeaconBlock.slotNumber,
      };
    }

    const sleepTime = this.getSleepTimeForNextSlot(nextSlot, latestFinalizedBeaconBlock.slotNumber);
    this.logger.info('Latest finalized slot [%d] found. Latest DB slot [%d]. Waiting [%d] seconds for next slot [%d]',
      latestFinalizedBeaconBlock.slotNumber, this.dataProcessor.latestSlotInDb, sleepTime, nextSlot);

    return new Promise(resolve => {
      setTimeout(() => resolve({ slotToWrite: 0n, stateRoot: '', slotNumber: 0n }), sleepTime * 1000);
    });
  }


  protected calculateNextFinalizedSlot(): bigint {
    const step = BigInt(this.env.FETCH_INTERVAL_SLOTS);
    const startingSlot = this.dataProcessor.latestSlotInDb >= BigInt(this.env.START_SLOT)
      ? this.dataProcessor.latestSlotInDb
      : BigInt(this.env.START_SLOT);

    this.logger.info('Starting slot [%d]', startingSlot);

    const epoch = startingSlot / step;
    const latestSlotInEpoch = (epoch) * step + (step - 1n);

    this.logger.info('Starting slot (end of epoch [%d]). Recalculated [%d]', epoch, latestSlotInEpoch);

    return (latestSlotInEpoch == startingSlot) ? latestSlotInEpoch + step : latestSlotInEpoch;
  }

  protected getSleepTimeForNextSlot(nextSlot: bigint, latestFinalizedSlot: bigint): number {
    let sleepTime = (
      Math.abs(Number((nextSlot - latestFinalizedSlot))) * (this.env.CHAIN_SLOT_TIME_SECONDS) + this.env.CHAIN_SLOT_TIME_SECONDS
    );

    if (sleepTime > 400) {
      sleepTime = 10;
    }

    return sleepTime;
  }

  protected async calculateHeadEpoch(): Promise<bigint> {
    const actualSlotHeader = await this.lighthouse.getBeaconBlockHeader('head');
    return actualSlotHeader.slotNumber / BigInt(this.env.FETCH_INTERVAL_SLOTS);
  }
}
