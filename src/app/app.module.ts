import { Module } from '@nestjs/common';

import { PrometheusModule } from 'common/prometheus';
import { ConfigModule } from 'common/config';
import { HealthModule } from 'common/health';
import { AppService } from './app.service';
import { LoggerModule } from 'common/logger';
import { InspectorModule } from '../inspector';
import { ContractsModule } from 'common/contracts';
import { EthProvidersModule } from 'common/eth-providers';
import { ClickhouseModule } from 'storage/clickhouse';
import { DatabaseModule } from 'storage/database';

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
