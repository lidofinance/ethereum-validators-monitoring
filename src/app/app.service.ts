import { Inject, Injectable, LoggerService, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';

import { ConfigService } from '../common/config';
import { APP_NAME, APP_VERSION } from './app.constants';
import { PrometheusService } from '../common/prometheus';
import { InspectorService } from '../inspector';

@Injectable()
export class AppService implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly configService: ConfigService,
    protected readonly promService: PrometheusService,
    protected readonly inspectorService: InspectorService,
  ) {}

  public onModuleInit(): void {
    const env = this.configService.get('NODE_ENV');
    const version = APP_VERSION;
    const name = APP_NAME;

    this.promService.buildInfo.labels({ env, name, version }).inc();
    this.logger.log('Init app', { env, name, version });
  }

  public async onApplicationBootstrap(): Promise<void> {
    this.inspectorService.startLoop().then();
  }
}
