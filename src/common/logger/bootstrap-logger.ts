/** Configuration is validated while ConfigModule is being defined, as AppModule is imported —
 * before bootstrap() exists, let alone app.useLogger(). */
import { LoggerModule, jsonTransport, simpleTransport } from '@lido-nestjs/logger';
import { LoggerService } from '@nestjs/common';

import { LogFormat } from 'common/config/interfaces';

/** LOG_LEVEL is not honoured: a level that filtered this out would leave the process exiting
 * silently. */
export function createBootstrapLogger(format: unknown, secrets: string[]): LoggerService {
  const transports = format === LogFormat.simple ? simpleTransport({ secrets }) : jsonTransport({ secrets });

  return LoggerModule.createLogger({ level: 'debug', transports });
}
