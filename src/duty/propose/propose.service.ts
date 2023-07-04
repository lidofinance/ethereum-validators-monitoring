import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/consensus-provider';
import { Epoch } from 'common/consensus-provider/types';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { SummaryService } from 'duty/summary';

@Injectable()
export class ProposeService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
  ) {}

  @TrackTask('check-proposer-duties')
  public async check(epoch: Epoch): Promise<void> {
    this.logger.log(`Start getting proposers duties info`);
    const proposersDutyInfo = await this.clClient.getCanonicalProposerDuties(epoch);
    this.logger.log(`Processing proposers duties info`);
    for (const prop of proposersDutyInfo) {
      const index = Number(prop.validator_index);
      const slot = Number(prop.slot);
      const blockHeader = await this.clClient.getBlockHeader(prop.slot);
      this.summary.epoch(epoch).set({
        epoch,
        val_id: index,
        is_proposer: true,
        block_to_propose: slot,
        block_proposed: !!blockHeader,
      });
    }
  }
}
