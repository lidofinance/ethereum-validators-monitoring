import { IHttpServer }                       from './IHttpServer';
import { implementationOf }                  from '../common/decorators/implementationOf';
import { inject, injectable, postConstruct } from 'inversify';
import { Environment }                       from '../environment/Environment';
import { ILogger }                           from '../logger/ILogger';
import fastify                               from 'fastify';
import { FastifyInstance }                   from 'fastify/types/instance';
import { Prometheus }                        from '../prometheus/Prometheus';

@injectable()
@implementationOf(IHttpServer)
export class HttpServerFastify implements IHttpServer {
  public server: FastifyInstance;

  public constructor(
    @inject(Environment) protected environment: Environment,
    @inject(Prometheus) protected prometheus: Prometheus,
    @inject(ILogger) protected logger: ILogger,
  ) {
    this.server = fastify({
      logger: logger,
      disableRequestLogging: true
    });
  }

  @postConstruct()
  public async initialize(): Promise<void> {
    this.server.get('/metrics', async (res, rep) => {
      this.prometheus.metrics.then(v => rep.send(v));
      await rep;
    });

    this.server.listen(this.environment.HTTP_PORT, '0.0.0.0', (err, address) => {
      if (err) {
        this.server.log.error(err);
        process.exit(1);
      }
      this.server.log.info(`Metrics server listening at ${address}`);
    });
  }
}
