import { Module } from '@nestjs/common';
import { CriticalAlertsService } from './critical-alerts.service';
import { StorageModule } from '../../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [CriticalAlertsService],
  exports: [CriticalAlertsService],
})
export class CriticalAlertsModule {}
