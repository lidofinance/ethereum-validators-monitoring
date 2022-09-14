import { Global, Module } from '@nestjs/common';
import { FallbackProviderModule } from '@lido-nestjs/execution';
import { PrometheusService, RequestStatus } from 'common/prometheus';
import { ConfigService } from 'common/config';
import { ExecutionProviderService } from './execution-provider.service';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';

@Global()
@Module({
  imports: [
    FallbackProviderModule.forRootAsync({
      async useFactory(configService: ConfigService, prometheusService: PrometheusService) {
        return {
          urls: configService.get('EL_RPC_URLS') as NonEmptyArray<string>,
          network: configService.get('ETH_NETWORK'),
          fetchMiddlewares: [
            // todo: metrics middleware with request name and rpc url
            async (next) => {
              const stop = prometheusService.outgoingELRequestsDuration.startTimer({
                name: next.name,
                target: next.name,
              });
              return await next()
                .then((r: any) => {
                  prometheusService.outgoingELRequestsCount.inc({
                    name: next.name,
                    target: next.name,
                    status: RequestStatus.COMPLETE,
                  });
                  return r;
                })
                .catch((e: any) => {
                  prometheusService.outgoingELRequestsCount.inc({
                    name: next.name,
                    target: next.name,
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
