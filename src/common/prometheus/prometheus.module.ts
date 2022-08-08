import { PrometheusModule as PrometheusModuleSource } from '@willsoto/nestjs-prometheus';
import { METRICS_PREFIX, METRICS_URL } from './prometheus.constants';
import { PrometheusController } from './prometheus.controller';
import { PrometheusService } from './prometheus.service';
import { ConfigModule } from '../config';

export const PrometheusModule = PrometheusModuleSource.register({
  controller: PrometheusController,
  path: METRICS_URL,
  defaultMetrics: {
    enabled: true,
    config: { prefix: METRICS_PREFIX },
  },
});

PrometheusModule.global = true;
PrometheusModule.providers = [PrometheusService];
PrometheusModule.exports = [PrometheusService];
PrometheusModule.imports = [ConfigModule];
