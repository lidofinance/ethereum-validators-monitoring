import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/consensus-provider';
import { ClickhouseModule } from 'storage/clickhouse';

import { SummaryMetrics } from './summary.metrics';
import { SummaryService } from './summary.service';

@Module({
  imports: [ConsensusProviderModule, ClickhouseModule],
  providers: [SummaryService, SummaryMetrics],
  exports: [SummaryService, SummaryMetrics],
})
export class SummaryModule {}
