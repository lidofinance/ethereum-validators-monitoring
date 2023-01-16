import { BigNumber } from '@ethersproject/bignumber';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';

import { ConfigService } from 'common/config';
import { ConsensusProviderService, StateValidatorResponse, ValStatus } from 'common/eth-providers';
import { Epoch, Slot } from 'common/eth-providers/consensus-provider/types';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { ClickhouseService } from 'storage/clickhouse';

import { bigNumberSqrt } from '../../common/functions/bigNumberSqrt';
import { SummaryService } from '../summary';

@Injectable()
export class StateService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
    protected readonly storage: ClickhouseService,
    protected readonly registry: RegistryService,
  ) {}

  @TrackTask('check-state-duties')
  public async check(epoch: Epoch, stateSlot: Slot): Promise<void> {
    const slotTime = await this.clClient.getSlotTime(epoch * this.config.get('FETCH_INTERVAL_SLOTS'));
    const keysIndexed = await this.registry.getActualKeysIndexed(Number(slotTime));
    this.logger.log('Getting all validators state');
    const readStream = await this.clClient.getValidatorsState(stateSlot);
    this.logger.log('Processing all validators state');
    let activeValidatorsCount = 0;
    let activeValidatorsEffectiveBalance = BigNumber.from(0);
    const pipeline = chain([readStream, parser(), pick({ filter: 'data' }), streamArray()]);
    const streamTask = async () =>
      new Promise((resolve, reject) => {
        pipeline.on('data', (data) => {
          const state: StateValidatorResponse = data.value;
          const index = Number(state.index);
          const operator = keysIndexed.get(state.validator.pubkey);
          this.summary.set(index, {
            epoch,
            val_id: index,
            val_pubkey: state.validator.pubkey,
            val_nos_id: operator?.operatorIndex,
            val_nos_name: operator?.operatorName,
            val_slashed: state.validator.slashed,
            val_status: state.status,
            val_balance: BigNumber.from(state.balance),
            val_effective_balance: BigNumber.from(state.validator.effective_balance),
          });
          if ([ValStatus.ActiveOngoing, ValStatus.ActiveExiting, ValStatus.ActiveSlashed].includes(state.status)) {
            activeValidatorsCount++;
            activeValidatorsEffectiveBalance = activeValidatorsEffectiveBalance.add(state.validator.effective_balance);
          }
        });
        pipeline.on('error', (error) => reject(error));
        pipeline.on('end', () => resolve(true));
      });
    await streamTask().finally(() => pipeline.destroy());
    const baseReward = Math.trunc(
      BigNumber.from(64 * 10 ** 9)
        .div(bigNumberSqrt(activeValidatorsEffectiveBalance))
        .toNumber(),
    );
    this.summary.setMeta({
      state: {
        active_validators: activeValidatorsCount,
        active_validators_total_increments: activeValidatorsEffectiveBalance.div(10 ** 9),
        base_reward: baseReward,
      },
    });
  }
}
