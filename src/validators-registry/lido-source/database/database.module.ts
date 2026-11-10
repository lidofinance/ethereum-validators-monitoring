import { FlushMode } from '@mikro-orm/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { SqliteDriver } from '@mikro-orm/sqlite';
import { Global, Module } from '@nestjs/common';

import { ConfigService } from 'common/config';

import { DatabaseService } from './database.service';

@Global()
@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      driver: SqliteDriver,
      async useFactory(configService: ConfigService) {
        return {
          dbName: configService.get('VALIDATOR_REGISTRY_LIDO_SOURCE_SQLITE_CACHE_PATH'),
          driver: SqliteDriver,
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
