import { Module } from '@nestjs/common';
import { RegistryService } from './registry.service';
import { ConfigService } from '../config';
import { LidoSourceModule, LidoSourceService } from './lido-source';
import { REGISTRY_SOURCE, RegistrySource } from './registry-source.interface';
import { FileSourceModule, FileSourceService } from './file-source';

enum ValidatorRegistrySource {
  Lido = 'lido',
  File = 'file',
}

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
