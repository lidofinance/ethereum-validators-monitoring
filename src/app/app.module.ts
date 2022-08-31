import { Module } from '@nestjs/common';

import { PrometheusModule } from '../common/prometheus';
import { ConfigModule } from '../common/config';
import { HealthModule } from '../common/health';
import { AppService } from './app.service';
import { LoggerModule } from '../common/logger';
import { InspectorModule } from '../inspector';
import { EthereumModule } from '../ethereum/ethereum.module';
import { ValidatorsModule } from '../validators/validators.module';
import { ContractsModule } from '../common/contracts';
import { ExecutionProviderModule } from '../common/execution-provider';

@Module({
  imports: [
    LoggerModule,
    HealthModule,
    PrometheusModule,
    ConfigModule,
    EthereumModule,
    InspectorModule,
    ValidatorsModule,
    ContractsModule,
    ExecutionProviderModule,
  ],
  providers: [AppService],
})
export class AppModule {}
