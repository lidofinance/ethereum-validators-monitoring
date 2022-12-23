import { Module } from '@nestjs/common';

import { ClickhouseModule } from 'storage/clickhouse';

import { RegistryModule } from '../validators-registry';
import { CriticalAlertsService } from './critical-alerts.service';

@Module({
  imports: [RegistryModule, ClickhouseModule],
  providers: [CriticalAlertsService],
  exports: [CriticalAlertsService],
})
export class CriticalAlertsModule {}
