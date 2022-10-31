import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';
import { RegistrySourceKeysIndexed } from 'common/validators-registry';
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
  ) {}

  public async check(epoch: bigint, stateSlot: bigint, keysIndexed: RegistrySourceKeysIndexed): Promise<void> {
    this.logger.log('Getting all validators state');
    const states = await this.clClient.getValidatorsState(stateSlot);
    this.logger.log('Processing all validators state');
    const setSummary = (): boolean => {
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
          state_is_compete: true,
        });
      }
      return true;
    };
    await Promise.all([this.storage.writeIndexes(states), setSummary()]);
  }
}
