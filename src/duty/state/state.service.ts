import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService, StateValidatorResponse } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';
import { RegistrySourceKeysIndexed } from 'common/validators-registry';
import { ValidatorsStatusStats, status } from 'storage/clickhouse';

export interface FetchFinalizedSlotDataResult {
  states: StateValidatorResponse[];
  otherCounts: ValidatorsStatusStats;
}

@Injectable()
export class StateService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
  ) {}

  public async getValidatorsState(stateRoot: string): Promise<StateValidatorResponse[]> {
    this.logger.log('Start getting all validators state');
    return await this.clClient.getValidatorsState(stateRoot);
  }

  public async prepStatesToWrite(
    balances: StateValidatorResponse[],
    keysIndexed: RegistrySourceKeysIndexed,
  ): Promise<FetchFinalizedSlotDataResult> {
    return await this.prometheus.trackTask('prep-balances', async () => {
      const otherCounts: ValidatorsStatusStats = {
        active_ongoing: 0,
        pending: 0,
        slashed: 0,
      };
      const filtered = balances.filter((b) => {
        if (keysIndexed.has(b.validator.pubkey)) {
          return true;
        } else {
          if (status.isActive(b)) otherCounts.active_ongoing++;
          else if (status.isPending(b)) otherCounts.pending++;
          else if (status.isSlashed(b)) otherCounts.slashed++;
          return false;
        }
      });
      return { states: filtered, otherCounts };
    });
  }
}
