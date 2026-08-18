import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { ConfigService } from 'common/config';

import { AppModule } from './app';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), { bufferLogs: true });

  // config
  const configService: ConfigService = app.get(ConfigService);
  const appPort = configService.get('HTTP_PORT');

  // versions
  app.enableVersioning({ type: VersioningType.URI });

  // logger
  app.useLogger(app.get(LOGGER_PROVIDER));

  // Lifecycle hooks on SIGTERM/SIGINT. Without this the process still exits — node's default
  // disposition does that — but it exits without running onModuleDestroy, so the ClickHouse client
  // is never closed and the inspector is cut mid-cycle instead of stopping between epochs.
  app.enableShutdownHooks();

  // app
  await app.listen(appPort, '0.0.0.0');
}
bootstrap();
