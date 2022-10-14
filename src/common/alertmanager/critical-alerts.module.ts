import { Module } from '@nestjs/common';
import { CriticalAlertsService } from './critical-alerts.service';
import { ClickhouseModule } from 'storage/clickhouse';

@Module({
  imports: [ClickhouseModule],
  providers: [CriticalAlertsService],
  exports: [CriticalAlertsService],
})
export class CriticalAlertsModule {}
