import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { FlushMode } from '@mikro-orm/core';
import { ConfigService } from '../../common/config';

@Global()
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      async useFactory(configService: ConfigService) {
        return {
          dbName: configService.get('VALIDATOR_REGISTRY_LIDO_SOURCE_SQLITE_CACHE_PATH'),
          type: 'sqlite',
          allowGlobalContext: true,
          autoLoadEntities: true,
          cache: { enabled: false },
          flushMode: FlushMode.ALWAYS,
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
