import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/consensus-provider';
import { SummaryModule } from 'duty/summary';
import { ClickhouseModule } from 'storage/clickhouse';

import { ProposeMetrics } from './propose.metrics';
import { ProposeRewards } from './propose.rewards';
import { ProposeService } from './propose.service';

@Module({
  imports: [ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [ProposeService, ProposeMetrics, ProposeRewards],
  exports: [ProposeService, ProposeMetrics, ProposeRewards],
})
export class ProposeModule {}
