import { FallbackProviderModule } from '@lido-nestjs/execution';
import { Global, Module } from '@nestjs/common';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';

import { ConfigService } from 'common/config';
import { PrometheusService, RequestStatus } from 'common/prometheus';

import { ExecutionProviderService } from './execution-provider.service';

@Global()
@Module({
  imports: [
    FallbackProviderModule.forRootAsync({
      async useFactory(configService: ConfigService, prometheusService: PrometheusService) {
        return {
          urls: configService.get('EL_RPC_URLS') as NonEmptyArray<string>,
          network: configService.get('ETH_NETWORK'),
          fetchMiddlewares: [
            async (next, ctx) => {
              const targetName = new URL(ctx.provider.connection.url).hostname;
              const reqName = 'batch';
              const stop = prometheusService.outgoingELRequestsDuration.startTimer({
                name: reqName,
                target: targetName,
              });
              return await next()
                .then((r: any) => {
                  prometheusService.outgoingELRequestsCount.inc({
                    name: reqName,
                    target: targetName,
                    status: RequestStatus.COMPLETE,
                  });
                  return r;
                })
                .catch((e: any) => {
                  prometheusService.outgoingELRequestsCount.inc({
                    name: reqName,
                    target: targetName,
                    status: RequestStatus.ERROR,
                  });
                  throw e;
                })
                .finally(() => stop());
            },
          ],
        };
      },
      inject: [ConfigService, PrometheusService],
    }),
  ],
  providers: [ExecutionProviderService],
  exports: [ExecutionProviderService],
})
export class ExecutionProviderModule {}
