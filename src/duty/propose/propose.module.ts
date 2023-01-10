import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';
import { RegistryModule } from 'common/validators-registry';
import { ClickhouseModule } from 'storage/clickhouse';

import { SummaryModule } from '../summary';
import { ProposeMetrics } from './propose.metrics';
import { ProposeRewards } from './propose.rewards';
import { ProposeService } from './propose.service';

@Module({
  imports: [RegistryModule, ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [ProposeService, ProposeMetrics, ProposeRewards],
  exports: [ProposeService, ProposeMetrics, ProposeRewards],
})
export class ProposeModule {}
