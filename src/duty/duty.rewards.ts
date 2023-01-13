import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { Epoch } from 'common/eth-providers/consensus-provider/types';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { AttestationRewards } from './attestation';
import { ProposeRewards } from './propose';
import { EpochMeta } from './summary';
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
  public async calculate(epoch: Epoch, prevEpochMetadata: EpochMeta) {
    // todo: 'Slashed' case
    // todo: 'Inactivity leak' case
    await Promise.all([this.attestationRewards.calculate(epoch), this.syncRewards.calculate(epoch)]);
    // should be calculated based on attestation and sync rewards
    await this.proposerRewards.calculate(epoch, prevEpochMetadata);
  }
}
