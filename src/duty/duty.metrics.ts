import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockHeaderResponse, ConsensusProviderService } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';

import { AttestationMetrics } from './attestation';
import { ProposeMetrics } from './propose';
import { StateMetrics } from './state';
import { SummaryMetrics } from './summary';
import { SyncMetrics, SyncService } from './sync';

@Injectable()
export class DutyMetrics {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,

    protected readonly sync: SyncService,

    protected readonly stateMetrics: StateMetrics,
    protected readonly attestationMetrics: AttestationMetrics,
    protected readonly proposeMetrics: ProposeMetrics,
    protected readonly syncMetrics: SyncMetrics,
    protected readonly summaryMetrics: SummaryMetrics,
  ) {}

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

  private async getPossibleHighRewardValidators(): Promise<string[]> {
    return await this.prometheus.trackTask('high-reward-validators', async () => {
      const actualSlotHeader = <BlockHeaderResponse>await this.clClient.getBlockHeader('head');
      const headEpoch = BigInt(actualSlotHeader.header.message.slot) / BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
      this.logger.log('Start getting possible high reward validator indexes');
      const propDependentRoot = await this.clClient.getDutyDependentRoot(headEpoch);
      const [sync, prop] = await Promise.all([
        this.sync.getSyncCommitteeIndexedValidators(headEpoch, 'head'),
        this.clClient.getCanonicalProposerDuties(headEpoch, propDependentRoot),
      ]);
      return [...new Set([...sync, ...prop].map((v) => v.validator_index))];
    });
  }
}
