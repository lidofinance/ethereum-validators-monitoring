import { Global, Module } from '@nestjs/common';
import { ConfigModule as ConfigModuleSource } from '@nestjs/config';

import { ConfigService } from './config.service';
import { validate } from './env.validation';

@Global()
@Module({
  imports: [
    ConfigModuleSource.forRoot({
      validate: validate,
      isGlobal: true,
      cache: true,
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
