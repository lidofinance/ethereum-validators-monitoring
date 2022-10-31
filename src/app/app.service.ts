import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';

import * as buildInfo from 'build-info';
import { ConfigService } from 'common/config';
import { ExecutionProviderService } from 'common/eth-providers';
import { PrometheusService } from 'common/prometheus';

import { InspectorService } from '../inspector';
import { APP_NAME } from './app.constants';

@Injectable()
export class AppService implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly configService: ConfigService,
    protected readonly promService: PrometheusService,
    protected readonly inspectorService: InspectorService,
    protected readonly executionProviderService: ExecutionProviderService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const env = this.configService.get('NODE_ENV');
    const startSlot = this.configService.get('START_SLOT');
    const network = await this.executionProviderService.getNetworkName();
    const version = buildInfo.version;
    const commit = buildInfo.commit;
    const branch = buildInfo.branch;
    const name = APP_NAME;

    this.promService.buildInfo.labels({ env, name, version, commit, branch }).inc();
    this.logger.log('Init app', { env, network, name, version, startSlot });
    this.logger.log(`DRY RUN ${this.configService.get('DRY_RUN') ? 'enabled' : 'disabled'}`);
    this.logger.log(`Slot time: ${this.configService.get('CHAIN_SLOT_TIME_SECONDS')} seconds`);
    this.logger.log(`Epoch size: ${this.configService.get('FETCH_INTERVAL_SLOTS')} slots`);
  }

  public async onApplicationBootstrap(): Promise<void> {
    this.inspectorService.startLoop().then();
  }
}
