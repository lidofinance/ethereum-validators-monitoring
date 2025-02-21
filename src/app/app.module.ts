import { Module } from '@nestjs/common';

import { ConfigModule } from 'common/config';
import { HealthModule } from 'common/health';
import { LoggerModule } from 'common/logger';
import { PrometheusModule } from 'common/prometheus';
import { ClickhouseModule } from 'storage/clickhouse';

import { AppService } from './app.service';
import { InspectorModule } from '../inspector';

@Module({
  imports: [LoggerModule, HealthModule, ConfigModule, PrometheusModule, ClickhouseModule, InspectorModule],
  providers: [AppService],
})
export class AppModule {}
