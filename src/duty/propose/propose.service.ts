import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/eth-providers';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { SummaryService } from '../summary';

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
  public async check(epoch: bigint): Promise<void> {
    const propDutyDependentRoot = await this.clClient.getDutyDependentRoot(epoch);
    this.logger.log(`Proposer Duty root: ${propDutyDependentRoot}`);
    this.logger.log(`Start getting proposers duties info`);
    const proposersDutyInfo = await this.clClient.getCanonicalProposerDuties(epoch, propDutyDependentRoot);
    this.logger.log(`Processing proposers duties info`);
    for (const prop of proposersDutyInfo) {
      const index = BigInt(prop.validator_index);
      const slot = BigInt(prop.slot);
      const blockHeader = await this.clClient.getBlockHeader(prop.slot);
      this.summary.set(index, {
        epoch,
        val_id: index,
        is_proposer: true,
        block_to_propose: slot,
        block_proposed: !!blockHeader,
      });
    }
  }
}
