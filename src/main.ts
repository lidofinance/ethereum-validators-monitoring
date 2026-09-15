import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

import { ConfigService, bootstrapLogger } from 'common/config';

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
  // The trace goes in the second argument on purpose: cleanSecrets walks enumerable fields only,
  // and `stack` is not one, so an Error passed as the message loses its trace entirely.
  bootstrapLogger().error('Startup failed', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
