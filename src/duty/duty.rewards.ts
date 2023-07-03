import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { allSettled } from 'common/functions/allSettled';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { Epoch } from '../common/consensus-provider/types';
import { AttestationRewards } from './attestation';
import { ProposeRewards } from './propose';
import { SyncRewards } from './sync';

@Injectable()
export class DutyRewards {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,

    protected readonly attestationRewards: AttestationRewards,
    protected readonly syncRewards: SyncRewards,
    protected readonly proposerRewards: ProposeRewards,
  ) {}

  @TrackTask('calc-all-duties-rewards')
  public async calculate(epoch: Epoch) {
    // todo: 'Slashed' case
    // todo: 'Inactivity leak' case
    this.logger.log('Calculate rewards for all duties');
    await allSettled([this.attestationRewards.calculate(epoch), this.syncRewards.calculate(epoch), this.proposerRewards.calculate(epoch)]);
  }
}
