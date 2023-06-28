import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { LoggerService, Module } from '@nestjs/common';

import { ConfigService, ValidatorRegistrySource } from 'common/config';

import { FileSourceModule, FileSourceService } from './file-source';
import { KeysapiSourceModule, KeysapiSourceService } from './keysapi-source';
import { LidoSourceModule, LidoSourceService } from './lido-source';
import { REGISTRY_SOURCE, RegistrySource } from './registry-source.interface';
import { RegistryService } from './registry.service';

@Module({
  imports: [LidoSourceModule, FileSourceModule, KeysapiSourceModule],
  providers: [
    RegistryService,
    {
      provide: REGISTRY_SOURCE,
      useFactory: async (
        logger: LoggerService,
        config: ConfigService,
        lido: LidoSourceService,
        file: FileSourceService,
        keysapi: KeysapiSourceService,
      ): Promise<RegistrySource> => {
        switch (config.get('VALIDATOR_REGISTRY_SOURCE')) {
          case ValidatorRegistrySource.Lido:
            logger.warn('DEPRECATED: VALIDATOR_REGISTRY_SOURCE=lido. Use VALIDATOR_REGISTRY_SOURCE=keysapi instead');
            return lido;
          case ValidatorRegistrySource.File:
            return file;
          case ValidatorRegistrySource.KeysAPI:
            return keysapi;
        }
      },
      inject: [LOGGER_PROVIDER, ConfigService, LidoSourceService, FileSourceService, KeysapiSourceService],
    },
  ],
  exports: [RegistryService],
})
export class RegistryModule {}
