import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { ConfigService } from 'common/config';

import { AppModule } from './app';

async function bootstrap() {
  // An idle keep-alive socket left by a scrape otherwise holds close() open until Fastify's
  // keep-alive timeout, long after the shutdown has finished its own work.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, forceCloseConnections: true }),
    { bufferLogs: true },
  );

  // config
  const configService: ConfigService = app.get(ConfigService);
  const appPort = configService.get('HTTP_PORT');

  // versions
  app.enableVersioning({ type: VersioningType.URI });

  // logger
  app.useLogger(app.get(LOGGER_PROVIDER));

  // Lifecycle hooks on SIGTERM/SIGINT: without them the process still exits, but onModuleDestroy
  // never runs and the inspector is cut mid-cycle.
  app.enableShutdownHooks();

  // app
  await app.listen(appPort, '0.0.0.0');
}
// A startup failure ends the process either way; caught, it ends with one line saying so instead of
// an unhandled rejection's stack trace.
bootstrap().catch((error) => {
  console.error('Startup failed', error);
  process.exit(1);
});
