import { FallbackProviderModule, NonEmptyArray } from '@lido-nestjs/execution';
import { Global, Module } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';

import { executionProviderConfig } from './execution-provider.config';
import { ExecutionProviderService } from './execution-provider.service';

@Global()
@Module({
  imports: [
    FallbackProviderModule.forRootAsync({
      async useFactory(configService: ConfigService, prometheusService: PrometheusService) {
        return executionProviderConfig(
          configService.get('EL_RPC_URLS') as NonEmptyArray<string>,
          configService.get('ETH_NETWORK'),
          prometheusService,
        );
      },
      inject: [ConfigService, PrometheusService],
    }),
  ],
  providers: [ExecutionProviderService],
  exports: [ExecutionProviderService],
})
export class ExecutionProviderModule {}
