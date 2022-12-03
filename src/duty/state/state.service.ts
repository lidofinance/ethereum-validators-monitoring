import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService, ValStatus } from 'common/eth-providers';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { RegistryService } from 'common/validators-registry';
import { ClickhouseService } from 'storage/clickhouse';

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
  public async check(epoch: bigint, stateSlot: bigint): Promise<void> {
    const slotTime = await this.clClient.getSlotTime(epoch * BigInt(this.config.get('FETCH_INTERVAL_SLOTS')));
    const keysIndexed = await this.registry.getActualKeysIndexed(Number(slotTime));
    this.logger.log('Getting all validators state');
    const states = await this.clClient.getValidatorsState(stateSlot);
    this.logger.log('Processing all validators state');
    let activeValidatorsCount = 0;
    let activeValidatorsEffectiveBalance = 0n;
    const setSummary = (): void => {
      for (const state of states) {
        const index = BigInt(state.index);
        const operator = keysIndexed.get(state.validator.pubkey);
        this.summary.set(index, {
          epoch,
          val_id: index,
          val_nos_id: operator?.operatorIndex,
          val_nos_name: operator?.operatorName,
          val_slashed: state.validator.slashed,
          val_status: state.status,
          val_balance: BigInt(state.balance),
          val_effective_balance: BigInt(state.validator.effective_balance),
        });
        if ([ValStatus.ActiveOngoing, ValStatus.ActiveExiting, ValStatus.ActiveSlashed].includes(state.status)) {
          activeValidatorsCount++;
          activeValidatorsEffectiveBalance += BigInt(state.validator.effective_balance);
        }
      }
    };
    await Promise.all([this.storage.writeIndexes(states), setSummary()]);
    // todo: change to bigint.sqrt
    const baseReward = Math.trunc((64 * 10 ** 9) / Math.trunc(Math.sqrt(Number(activeValidatorsEffectiveBalance))));
    this.summary.setMeta(epoch, {
      state: {
        active_validators: activeValidatorsCount,
        active_validators_total_increments: activeValidatorsEffectiveBalance / BigInt(10 ** 9),
        base_reward: baseReward,
      },
    });
  }
}
