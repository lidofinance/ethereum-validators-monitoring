import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';
import { RegistryModule } from 'common/validators-registry';
import { ClickhouseModule } from 'storage/clickhouse';

import { SummaryModule } from '../summary';
import { SyncMetrics } from './sync.metrics';
import { SyncRewards } from './sync.rewards';
import { SyncService } from './sync.service';

@Module({
  imports: [RegistryModule, ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [SyncService, SyncMetrics, SyncRewards],
  exports: [SyncService, SyncMetrics, SyncRewards],
})
export class SyncModule {}
