import { Module } from '@nestjs/common';

import { ConfigModule } from 'common/config';
import { ContractsModule } from 'common/contracts';
import { EthProvidersModule } from 'common/eth-providers';
import { HealthModule } from 'common/health';
import { LoggerModule } from 'common/logger';
import { PrometheusModule } from 'common/prometheus';
import { ClickhouseModule } from 'storage/clickhouse';
import { DatabaseModule } from 'storage/database';

import { InspectorModule } from '../inspector';
import { AppService } from './app.service';

@Module({
  imports: [
    LoggerModule,
    HealthModule,
    PrometheusModule,
    ConfigModule,
    DatabaseModule,
    ClickhouseModule,
    InspectorModule,
    ContractsModule,
    EthProvidersModule,
  ],
  providers: [AppService],
})
export class AppModule {}
