/**
 * The logger for the window the DI one does not cover.
 *
 * Configuration is validated while ConfigModule is being defined, which happens as AppModule is
 * imported — before bootstrap() exists, let alone app.useLogger(). Anything reported there used to
 * go to console: raw, unredacted, and in neither of the two formats the log pipeline parses.
 */
import { LoggerModule, jsonTransport, simpleTransport } from '@lido-nestjs/logger';
import { LoggerService } from '@nestjs/common';

import { LogFormat } from 'common/config/interfaces';

/**
 * Same transports as the DI logger, so both emit the same shape and the same <removed>.
 *
 * LOG_LEVEL is deliberately not honoured: this logger only ever reports a startup failure, and a
 * level that filtered it out would leave the process exiting silently. An unrecognised LOG_FORMAT
 * falls back to JSON — reporting a broken configuration must not itself depend on a valid one.
 */
export function createBootstrapLogger(format: unknown, secrets: string[]): LoggerService {
  const transports = format === LogFormat.simple ? simpleTransport({ secrets }) : jsonTransport({ secrets });

  return LoggerModule.createLogger({ level: 'debug', transports });
}
