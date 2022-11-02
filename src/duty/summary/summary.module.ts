import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';

import { SummaryMetrics } from './summary.metrics';
import { SummaryService } from './summary.service';

@Module({
  imports: [ConsensusProviderModule],
  providers: [SummaryService, SummaryMetrics],
  exports: [SummaryService, SummaryMetrics],
})
export class SummaryModule {}
