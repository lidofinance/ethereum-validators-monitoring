import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { ClickhouseModule } from 'storage/clickhouse';

import { HealthController } from './health.controller';

@Module({
  providers: [],
  controllers: [HealthController],
  imports: [TerminusModule, ClickhouseModule],
})
export class HealthModule {}
