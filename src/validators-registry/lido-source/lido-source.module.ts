import { ValidatorRegistryModule } from '@lido-nestjs/registry';
import { Module } from '@nestjs/common';

import { ExecutionProvider, ExecutionProviderModule } from 'common/execution-provider';

import { DatabaseModule } from './database';
import { LidoSourceService } from './lido-source.service';

@Module({
  imports: [
    DatabaseModule,
    ExecutionProviderModule,
    ValidatorRegistryModule.forFeatureAsync({
      async useFactory(provider: ExecutionProvider) {
        return { provider };
      },
      inject: [ExecutionProvider],
    }),
  ],
  providers: [LidoSourceService],
  exports: [LidoSourceService],
})
export class LidoSourceModule {}
