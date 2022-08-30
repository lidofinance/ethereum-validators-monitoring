import { Module } from '@nestjs/common';
import { ValidatorRegistryModule } from '@lido-nestjs/registry';
import { ExecutionProvider } from 'common/execution-provider';
import { RegistryService } from './registry.service';

@Module({
  imports: [
    ValidatorRegistryModule.forFeatureAsync({
      async useFactory(provider: ExecutionProvider) {
        return { provider };
      },
      inject: [ExecutionProvider],
    }),
  ],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
