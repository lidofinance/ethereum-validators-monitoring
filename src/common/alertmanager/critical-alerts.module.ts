import { Module } from '@nestjs/common';
import { CriticalAlertsService } from './critical-alerts.service';
import { PrometheusModule } from '../prometheus';
import { ClickhouseModule } from 'storage/clickhouse';

@Module({
  imports: [ClickhouseModule, PrometheusModule],
  providers: [CriticalAlertsService],
  exports: [CriticalAlertsService],
})
export class CriticalAlertsModule {}
