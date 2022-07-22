import { Module } from '@nestjs/common';

import { PrometheusModule } from '../common/prometheus';
import { ConfigModule } from '../common/config';
import { HealthModule } from '../common/health';
import { AppService } from './app.service';
import { LoggerModule } from '../common/logger';
import { InspectorModule } from '../inspector';
import { EthereumModule } from '../ethereum/ethereum.module';

@Module({
  imports: [LoggerModule, HealthModule, PrometheusModule, ConfigModule, EthereumModule, InspectorModule],
  providers: [AppService],
})
export class AppModule {}
