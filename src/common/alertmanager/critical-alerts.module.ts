import { Module } from '@nestjs/common';

import { ClickhouseModule } from 'storage/clickhouse';

import { CriticalAlertsService } from './critical-alerts.service';

@Module({
  imports: [ClickhouseModule],
  providers: [CriticalAlertsService],
  exports: [CriticalAlertsService],
})
export class CriticalAlertsModule {}
