import { Module } from '@nestjs/common';
import { InspectorService } from './inspector.service';
import { PrometheusModule } from '../common/prometheus';
import { CriticalAlertsModule } from '../common/alertmanager/critical-alerts.module';
import { StorageModule } from '../storage';
import { RegistryModule } from '../common/validators-registry';
import { EthProvidersModule } from '../common/eth-providers';
import { DataProcessingService } from './processing/data-processing.service';
import { StatsProcessingService } from './processing/stats-processing.service';

@Module({
  imports: [PrometheusModule, EthProvidersModule, CriticalAlertsModule, StorageModule, RegistryModule],
  providers: [InspectorService, DataProcessingService, StatsProcessingService],
  exports: [InspectorService],
})
export class InspectorModule {}
