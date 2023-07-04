import { Module } from '@nestjs/common';

import { CriticalAlertsModule } from 'common/alertmanager/critical-alerts.module';
import { ConsensusProviderModule } from 'common/consensus-provider';
import { BlockCacheModule } from 'common/consensus-provider/block-cache';
import { DutyModule } from 'duty';
import { ClickhouseModule } from 'storage/clickhouse';
import { RegistryModule } from 'validators-registry';

import { InspectorService } from './inspector.service';

@Module({
  imports: [BlockCacheModule, CriticalAlertsModule, ClickhouseModule, RegistryModule, DutyModule, ConsensusProviderModule],
  providers: [InspectorService],
  exports: [InspectorService],
})
export class InspectorModule {}
