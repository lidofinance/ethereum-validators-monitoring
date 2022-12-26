import { Module } from '@nestjs/common';

import { RegistryModule } from 'common/validators-registry';
import { ClickhouseModule } from 'storage/clickhouse';

import { CriticalAlertsService } from './critical-alerts.service';

@Module({
  imports: [RegistryModule, ClickhouseModule],
  providers: [CriticalAlertsService],
  exports: [CriticalAlertsService],
})
export class CriticalAlertsModule {}
