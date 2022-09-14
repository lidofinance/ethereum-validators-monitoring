import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { FlushMode } from '@mikro-orm/core';

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
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
