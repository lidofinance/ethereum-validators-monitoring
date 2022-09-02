import { Module } from '@nestjs/common';
import { InspectorService } from './inspector.service';
import { PrometheusModule } from '../common/prometheus';
import { CriticalAlertsModule } from '../common/alertmanager/critical-alerts.module';
import { RegistryModule } from '../common/validators-registry';
import { EthProvidersModule } from '../common/eth-providers';
import { DataProcessingService } from './processing/data-processing.service';
import { StatsProcessingService } from './processing/stats-processing.service';
import { ClickhouseModule } from '../storage/clickhouse';

@Module({
  imports: [PrometheusModule, EthProvidersModule, CriticalAlertsModule, ClickhouseModule, RegistryModule],
  providers: [InspectorService, DataProcessingService, StatsProcessingService],
  exports: [InspectorService],
})
export class InspectorModule {}
