import { Global, Module } from '@nestjs/common';
import { FallbackProviderModule } from '@lido-nestjs/execution';
import { PrometheusService, RequestStatus } from '../../prometheus';
import { ConfigService } from '../../config';
import { ExecutionProviderService } from './execution-provider.service';

@Global()
@Module({
  imports: [
    FallbackProviderModule.forRootAsync({
      async useFactory(configService: ConfigService, prometheusService: PrometheusService) {
        return {
          urls: [configService.get('EL_RPC_URL'), configService.get('EL_RPC_URL_BACKUP')],
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
