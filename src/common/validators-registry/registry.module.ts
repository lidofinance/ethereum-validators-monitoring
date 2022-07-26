import { Module } from '@nestjs/common';

import { ConfigService, ValidatorRegistrySource } from 'common/config';

import { FileSourceModule, FileSourceService } from './file-source';
import { LidoSourceModule, LidoSourceService } from './lido-source';
import { REGISTRY_SOURCE, RegistrySource } from './registry-source.interface';
import { RegistryService } from './registry.service';

@Module({
  imports: [LidoSourceModule, FileSourceModule],
  providers: [
    RegistryService,
    {
      provide: REGISTRY_SOURCE,
      useFactory: async (config: ConfigService, lido: LidoSourceService, file: FileSourceService): Promise<RegistrySource> => {
        switch (config.get('VALIDATOR_REGISTRY_SOURCE')) {
          case ValidatorRegistrySource.Lido:
            return lido;
          case ValidatorRegistrySource.File:
            return file;
        }
      },
      inject: [ConfigService, LidoSourceService, FileSourceService],
    },
  ],
  exports: [RegistryService],
})
export class RegistryModule {}
