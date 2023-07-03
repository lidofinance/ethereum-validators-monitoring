import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/consensus-provider';
import { SummaryModule } from 'duty/summary';
import { ClickhouseModule } from 'storage/clickhouse';

import { SyncMetrics } from './sync.metrics';
import { SyncRewards } from './sync.rewards';
import { SyncService } from './sync.service';

@Module({
  imports: [ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [SyncService, SyncMetrics, SyncRewards],
  exports: [SyncService, SyncMetrics, SyncRewards],
})
export class SyncModule {}
