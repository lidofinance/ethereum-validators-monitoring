import { Module } from '@nestjs/common';
import { DatabaseModule, DatabaseService } from './database';
import { ClickhouseModule, ClickhouseService } from './clickhouse';

@Module({
  imports: [DatabaseModule, ClickhouseModule],
  providers: [DatabaseService, ClickhouseService],
  exports: [ClickhouseService],
})
export class StorageModule {}
