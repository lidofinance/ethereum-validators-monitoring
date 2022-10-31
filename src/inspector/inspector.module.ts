import { Module } from '@nestjs/common';

import { CriticalAlertsModule } from 'common/alertmanager/critical-alerts.module';
import { EthProvidersModule } from 'common/eth-providers';
import { BlockCacheModule } from 'common/eth-providers/consensus-provider/block-cache';
import { RegistryModule } from 'common/validators-registry';
import { DutyModule } from 'duty';
import { ClickhouseModule } from 'storage/clickhouse';

import { InspectorService } from './inspector.service';
import { DataProcessingService } from './processing/data-processing.service';
import { StatsProcessingService } from './processing/stats-processing.service';

@Module({
  imports: [EthProvidersModule, CriticalAlertsModule, ClickhouseModule, RegistryModule, DutyModule, BlockCacheModule],
  providers: [InspectorService, DataProcessingService, StatsProcessingService],
  exports: [InspectorService],
})
export class InspectorModule {}
