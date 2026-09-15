import { FallbackProviderModule } from '@lido-nestjs/execution';
import { Global, Module } from '@nestjs/common';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';

import { createExecutionFetchMiddleware } from './execution-provider.middleware';
import { ExecutionProviderService } from './execution-provider.service';

@Global()
@Module({
  imports: [
    FallbackProviderModule.forRootAsync({
      async useFactory(configService: ConfigService, prometheusService: PrometheusService) {
        return {
          urls: configService.get('EL_RPC_URLS') as NonEmptyArray<string>,
          network: configService.get('ETH_NETWORK'),
          fetchMiddlewares: [createExecutionFetchMiddleware(prometheusService)],
        };
      },
      inject: [ConfigService, PrometheusService],
    }),
  ],
  providers: [ExecutionProviderService],
  exports: [ExecutionProviderService],
})
export class ExecutionProviderModule {}
