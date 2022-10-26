import { ValidatorRegistryModule } from '@lido-nestjs/registry';
import { Module } from '@nestjs/common';

import { ExecutionProvider } from 'common/eth-providers';

import { LidoSourceService } from './lido-source.service';

@Module({
  imports: [
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
