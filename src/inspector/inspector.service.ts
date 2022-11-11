import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';

import { CriticalAlertsService } from 'common/alertmanager';
import { ConfigService } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/eth-providers';
import { sleep } from 'common/functions/sleep';
import { PrometheusService } from 'common/prometheus';
import { DutyMetrics, DutyService } from 'duty';
import { ClickhouseService } from 'storage';

@Injectable()
export class InspectorService implements OnModuleInit {
  public latestProcessedEpoch = 0n;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly storage: ClickhouseService,
    protected readonly prometheus: PrometheusService,
    protected readonly criticalAlerts: CriticalAlertsService,

    protected readonly dutyService: DutyService,
    protected readonly dutyMetrics: DutyMetrics,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.log(`Starting slot [${this.config.get('START_SLOT')}]`);
    this.latestProcessedEpoch = await this.storage.getMaxEpoch();
    this.prometheus.epochTime = await this.clClient.getSlotTime(this.latestProcessedEpoch * 32n);
    this.prometheus.epochNumber.set(Number(this.latestProcessedEpoch));
  }

  public async startLoop(): Promise<never> {
    const version = await this.clClient.getVersion();
    this.logger.log(`Beacon chain API info [${version}]`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const nextFinalized = await this.waitForNextFinalizedSlot();
        if (nextFinalized) {
          const { epoch, stateSlot } = nextFinalized;
          const [possibleHighRewardValidators] = await Promise.all([
            this.dutyMetrics.getPossibleHighRewardValidators(),
            this.dutyService.checkAndWrite(epoch, stateSlot),
          ]);
          await this.dutyMetrics.calculate(epoch, possibleHighRewardValidators);
          await this.criticalAlerts.send(epoch);
          this.latestProcessedEpoch = epoch;
        }
      } catch (e) {
        this.logger.error(`Error while processing and writing epoch`);
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

  protected async waitForNextFinalizedSlot(): Promise<{ epoch: bigint; stateSlot: bigint } | undefined> {
    const nextSlot = this.calculateNextFinalizedSlot();
    const latestFinalizedBeaconBlock = <BlockHeaderResponse>await this.clClient.getBlockHeader('finalized');
    const latestFinalizedEpoch = BigInt(latestFinalizedBeaconBlock.header.message.slot) / 32n;
    if (BigInt(latestFinalizedBeaconBlock.header.message.slot) < nextSlot) {
      // new finalized slot hasn't happened, from which we should get information about needed
      // just wait `CHAIN_SLOT_TIME_SECONDS` until finality happens
      const sleepTime = this.config.get('CHAIN_SLOT_TIME_SECONDS');
      this.logger.log(
        `Latest finalized epoch [${latestFinalizedEpoch}] found. Latest DB epoch [${this.latestProcessedEpoch}]. Waiting [${sleepTime}] seconds for next finalized slot [${nextSlot}]`,
      );

      return new Promise((resolve) => {
        setTimeout(() => resolve(undefined), sleepTime * 1000);
      });
    }
    // new finalized slot has happened, from which we can get information about needed
    this.logger.log(
      `Latest finalized epoch [${latestFinalizedEpoch}] found. Next slot [${nextSlot}]. Latest DB epoch [${this.latestProcessedEpoch}]`,
    );

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

    return {
      epoch: nextProcessedEpoch,
      stateSlot: nextProcessedHeader.header.message.slot,
    };
  }

  protected calculateNextFinalizedSlot(): bigint {
    const step = BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    let startEpoch = BigInt(this.config.get('START_EPOCH'));
    if (this.latestProcessedEpoch >= startEpoch) {
      startEpoch = this.latestProcessedEpoch + 1n;
    }
    const slotToProcess = startEpoch * step + (step - 1n); // latest slot in epoch
    this.logger.log(`Slot to process [${slotToProcess}] (end of epoch [${startEpoch}])`);
    return slotToProcess;
  }
}
