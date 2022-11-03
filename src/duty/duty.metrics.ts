import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/eth-providers';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { AttestationMetrics } from './attestation';
import { ProposeMetrics } from './propose';
import { StateMetrics } from './state';
import { SummaryMetrics } from './summary';
import { SyncMetrics } from './sync';

@Injectable()
export class DutyMetrics {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,

    protected readonly stateMetrics: StateMetrics,
    protected readonly attestationMetrics: AttestationMetrics,
    protected readonly proposeMetrics: ProposeMetrics,
    protected readonly syncMetrics: SyncMetrics,
    protected readonly summaryMetrics: SummaryMetrics,
  ) {}

  @TrackTask('calc-all-duties-metrics')
  public async calculate(epoch: bigint): Promise<any> {
    this.logger.log('Calculating duties metrics of user validators');
    await Promise.all([this.withPossibleHighReward(epoch), this.stateMetrics.calculate(epoch), this.summaryMetrics.calculate(epoch)]);
  }

  private async withPossibleHighReward(epoch: bigint): Promise<void> {
    const possibleHighRewardValidators = await this.getPossibleHighRewardValidators();
    await Promise.all([
      this.attestationMetrics.calculate(epoch, possibleHighRewardValidators),
      this.proposeMetrics.calculate(epoch, possibleHighRewardValidators),
      this.syncMetrics.calculate(epoch, possibleHighRewardValidators),
    ]);
  }

  @TrackTask('high-reward-validators')
  private async getPossibleHighRewardValidators(): Promise<string[]> {
    const actualSlotHeader = <BlockHeaderResponse>await this.clClient.getBlockHeader('head');
    const headEpoch = BigInt(actualSlotHeader.header.message.slot) / BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    this.logger.log('Getting possible high reward validator indexes');
    const propDependentRoot = await this.clClient.getDutyDependentRoot(headEpoch);
    const [sync, prop] = await Promise.all([
      this.clClient.getSyncCommitteeInfo('head', headEpoch),
      this.clClient.getCanonicalProposerDuties(headEpoch, propDependentRoot),
    ]);
    return [...new Set([...prop.map((v) => v.validator_index), ...sync.validators])];
  }
}
