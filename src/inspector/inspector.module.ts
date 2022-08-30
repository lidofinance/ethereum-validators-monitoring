import { Module } from '@nestjs/common';
import { InspectorService } from './inspector.service';
import { PrometheusModule } from '../common/prometheus';
import { DataProcessingService } from './processing/data-processing.service';
import { StatsProcessingService } from './processing/stats-processing.service';
import { EthereumModule } from '../ethereum/ethereum.module';
import { CriticalAlertsModule } from '../common/alertmanager/critical-alerts.module';
import { StorageModule } from '../storage/storage.module';
import { RegistryModule } from '../validators/registry';

@Module({
  imports: [PrometheusModule, EthereumModule, CriticalAlertsModule, StorageModule, RegistryModule],
  providers: [InspectorService, DataProcessingService, StatsProcessingService],
  exports: [InspectorService],
})
export class InspectorModule {}
