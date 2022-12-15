import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from '../common/config';
import { PrometheusService, TrackTask } from '../common/prometheus';
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
  public async calculate(epoch: bigint) {
    // todo: 'Slashed' case
    await Promise.all([this.attestationRewards.calculate(epoch), this.syncRewards.calculate(epoch)]);
    // should be calculated based on attestation and sync rewards
    await this.proposerRewards.calculate(epoch);
  }
}