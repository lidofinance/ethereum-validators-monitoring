import { Module } from '@nestjs/common';

import { CriticalAlertsModule } from 'common/alertmanager/critical-alerts.module';
import { EthProvidersModule } from 'common/eth-providers';
import { RegistryModule } from 'common/validators-registry';
import { DutyModule } from 'duty';
import { ClickhouseModule } from 'storage/clickhouse';

import { InspectorService } from './inspector.service';

@Module({
  imports: [EthProvidersModule, CriticalAlertsModule, ClickhouseModule, RegistryModule, DutyModule],
  providers: [InspectorService],
  exports: [InspectorService],
})
export class InspectorModule {}
