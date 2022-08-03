import 'reflect-metadata';
import { Container }             from 'inversify';
import { Environment }           from './modules/environment/Environment';
import { Eth2Client }            from './modules/lighthouse/Eth2Client';
import { Logger }                from './modules/logger/Logger';
import { ILogger }               from './modules/logger/ILogger';
import { App }                   from './modules/main/App';
import { ClickhouseStorage }     from './modules/storage/ClickhouseStorage';
import { Prometheus }            from './modules/prometheus/Prometheus';
import { IHttpServer }           from './modules/HttpServer/IHttpServer';
import { HttpServerFastify }     from './modules/HttpServer/HttpServerFastify';
import { NodeOperatorsContract } from './modules/eth-rpc/NodeOperatorsContract';
import { StEthContract }         from './modules/eth-rpc/StEthContract';
import { DataProcessor }         from './modules/main/DataProcessing';
import { StatsProcessor }        from './modules/main/StatsProcessing';
import { CriticalAlertsService } from './modules/alertmanager/CriticalAlertsService';

export const container = new Container();

container.bind(ILogger).to(Logger).inSingletonScope();
container.bind(IHttpServer).to(HttpServerFastify).inSingletonScope();

container.bind(Environment)
  .toDynamicValue(async () => {
    const env = Environment.create();
    await env.initialize();
    return env;
  })
  .inSingletonScope()
  .onActivation((context, env) => {
    context.container.get(ILogger).setLevel(env.LOG_LEVEL);
    return env;
  });

container.bind(StEthContract).toSelf().inSingletonScope();
container.bind(NodeOperatorsContract).toSelf().inSingletonScope();
container.bind(Eth2Client).toSelf().inSingletonScope();
container.bind(ClickhouseStorage).toSelf().inSingletonScope();
container.bind(Prometheus).toSelf().inSingletonScope();
container.bind(DataProcessor).toSelf().inSingletonScope();
container.bind(StatsProcessor).toSelf().inSingletonScope();
container.bind(CriticalAlertsService).toSelf().inSingletonScope();
container.bind(App).toSelf().inSingletonScope();


