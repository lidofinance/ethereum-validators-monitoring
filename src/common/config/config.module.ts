import { ConfigModule as ConfigModuleSource } from '@nestjs/config';
import { ConfigService } from './config.service';
import { validate } from './env.validation';

export const ConfigModule = ConfigModuleSource.forRoot({
  validate,
  isGlobal: true,
  cache: true,
});

ConfigModule.providers.push(ConfigService);
ConfigModule.exports.push(ConfigService);
