import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';

import * as buildInfo from 'build-info';
import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';

import { APP_NAME } from './app.constants';
import { InspectorService } from '../inspector';

@Injectable()
export class AppService implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly configService: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly inspectorService: InspectorService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const env = this.configService.get('NODE_ENV');
    const startEpoch = this.configService.get('START_EPOCH');
    const version = buildInfo.version;
    const commit = buildInfo.commit;
    const branch = buildInfo.branch;
    const name = APP_NAME;

    this.prometheus.buildInfo.labels({ env, name, version, commit, branch }).inc();
    this.logger.log('Init app', { env, name, version, startEpoch });
    this.logger.log(`DRY RUN ${this.configService.get('DRY_RUN') ? 'enabled' : 'disabled'}`);
    this.logger.log(`Slot time: ${this.configService.get('CHAIN_SLOT_TIME_SECONDS')} seconds`);
    this.logger.log(`Epoch size: ${this.configService.get('FETCH_INTERVAL_SLOTS')} slots`);
  }

  public async onApplicationBootstrap(): Promise<void> {
    this.inspectorService.startLoop().then();
  }
}
