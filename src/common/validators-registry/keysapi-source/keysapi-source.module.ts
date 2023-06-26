import { ValidatorRegistryModule } from '@lido-nestjs/registry';
import { Module } from '@nestjs/common';

import { ExecutionProvider } from 'common/eth-providers';

import { KeysapiSourceClient } from './keysapi-source.client';
import { KeysapiSourceService } from './keysapi-source.service';

@Module({
  imports: [
    ValidatorRegistryModule.forFeatureAsync({
      async useFactory(provider: ExecutionProvider) {
        return { provider };
      },
      inject: [ExecutionProvider],
    }),
  ],
  providers: [KeysapiSourceService, KeysapiSourceClient],
  exports: [KeysapiSourceService],
})
export class KeysapiSourceModule {}
