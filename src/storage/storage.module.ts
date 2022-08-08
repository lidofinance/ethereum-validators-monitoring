import { Module } from '@nestjs/common';
import { ClickhouseStorageService } from './clickhouse-storage.service';

@Module({
  imports: [],
  providers: [ClickhouseStorageService],
  exports: [ClickhouseStorageService],
})
export class StorageModule {}
