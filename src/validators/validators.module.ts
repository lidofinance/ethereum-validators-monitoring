import { FlushMode } from '@mikro-orm/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Global, Module } from '@nestjs/common';
import { ValidatorsService } from './validators.service';
import { RegistryModule } from './registry';

@Global()
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      async useFactory() {
        return {
          dbName: ':memory:',
          type: 'sqlite',
          allowGlobalContext: true,
          autoLoadEntities: true,
          cache: { enabled: false },
          flushMode: FlushMode.ALWAYS,
        };
      },
    }),
    RegistryModule,
  ],
  providers: [ValidatorsService],
  exports: [ValidatorsService],
})
export class ValidatorsModule {}
