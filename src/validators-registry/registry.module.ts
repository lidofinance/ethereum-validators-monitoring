import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Global, LoggerService, Module } from '@nestjs/common';

import { ValidatorRegistrySource } from 'common/config';

import { FileSourceModule, FileSourceService } from './file-source';
import { KeysapiSourceModule, KeysapiSourceService } from './keysapi-source';
import { LidoSourceModule, LidoSourceService } from './lido-source';
import { REGISTRY_SOURCE, RegistrySource } from './registry-source.interface';
import { RegistryService } from './registry.service';

const selectSource = () => {
  switch (process.env['VALIDATOR_REGISTRY_SOURCE']) {
    case ValidatorRegistrySource.Lido:
      return {
        imports: [LidoSourceModule],
        providers: [
          RegistryService,
          {
            provide: REGISTRY_SOURCE,
            useFactory: async (logger: LoggerService, lido: LidoSourceService): Promise<RegistrySource> => {
              // todo: turn on in next major release
              // logger.warn('DEPRECATED: VALIDATOR_REGISTRY_SOURCE=lido. Use VALIDATOR_REGISTRY_SOURCE=keysapi instead');
              return lido;
            },
            inject: [LOGGER_PROVIDER, LidoSourceService],
          },
        ],
        exports: [RegistryService],
      };
    case ValidatorRegistrySource.File:
      return {
        imports: [FileSourceModule],
        providers: [
          RegistryService,
          {
            provide: REGISTRY_SOURCE,
            useFactory: async (file: FileSourceService): Promise<RegistrySource> => {
              return file;
            },
            inject: [FileSourceService],
          },
        ],
        exports: [RegistryService],
      };
    case ValidatorRegistrySource.KeysAPI:
      return {
        imports: [KeysapiSourceModule],
        providers: [
          RegistryService,
          {
            provide: REGISTRY_SOURCE,
            useFactory: async (keysapi: KeysapiSourceService): Promise<RegistrySource> => {
              return keysapi;
            },
            inject: [KeysapiSourceService],
          },
        ],
        exports: [RegistryService],
      };
  }
};

@Global()
@Module(selectSource())
export class RegistryModule {}
