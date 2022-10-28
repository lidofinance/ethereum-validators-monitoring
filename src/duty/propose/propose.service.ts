import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService, ProposerDutyInfo } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';

@Injectable()
export class ProposeService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
  ) {}

  public async getProposerDutyInfo(valIndexes: string[], dependentRoot: string, epoch: bigint): Promise<ProposerDutyInfo[]> {
    const proposersDutyInfo = await this.clClient.getCanonicalProposerDuties(epoch, dependentRoot);
    return proposersDutyInfo.filter((p) => valIndexes.includes(p.validator_index));
  }

  /**
   * Check Proposer duties and return user validators propose result
   **/
  public async checkProposerDuties(epoch: bigint, dutyDependentRoot: string, valIndexes: string[]): Promise<ProposerDutyInfo[]> {
    return await this.prometheus.trackTask('check-proposer-duties', async () => {
      this.logger.log(`Start getting proposers duties info`);
      const userProposersDutyInfo = await this.getProposerDutyInfo(valIndexes, dutyDependentRoot, epoch);
      this.logger.log(`Processing proposers duties info`);
      for (const userProp of userProposersDutyInfo) {
        userProp.proposed = false;
        const blockHeader = await this.clClient.getBeaconBlockHeader(userProp.slot);
        if (!blockHeader) continue; // it means that block is missed
        if (blockHeader.header.message.proposer_index == userProp.validator_index) userProp.proposed = true;
        else {
          throw Error(
            `Proposer duty info cannot be trusted. Make sure the node is synchronized!
          Expect block [${blockHeader.header.message.slot}] proposer - ${userProp.validator_index},
          but actual - ${blockHeader.header.message.proposer_index}`,
          );
        }
      }
      return userProposersDutyInfo;
    });
  }
}
