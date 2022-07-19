import pino, { Bindings, LogFn, Logger as PinoLogger } from 'pino';
import { ILogger }                                     from './ILogger';
import { injectable }                                  from 'inversify';
import { implementationOf }                            from '../common/decorators/implementationOf';

@injectable()
@implementationOf(ILogger)
export class Logger implements ILogger {
  private logger: PinoLogger;

  public constructor() {
    this.logger = pino({
      level: 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      prettyPrint: false,
      formatters: {
        // forcing log level printing as string
        level: (label) => ({ level: label.toLocaleUpperCase() }),
      }
    });
  }

  trace(...params: Parameters<LogFn>): void {
    const [msg, ...args] = params;
    this.logger.trace(msg, ...args);
  }

  debug(...params: Parameters<LogFn>): void {
    const [msg, ...args] = params;
    this.logger.debug(msg, ...args);
  }

  info(...params: Parameters<LogFn>): void {
    const [msg, ...args] = params;
    this.logger.info(msg, ...args);
  }

  warn(...params: Parameters<LogFn>): void {
    const [msg, ...args] = params;
    this.logger.warn(msg, ...args);
  }

  error(...params: Parameters<LogFn>): void {
    const [msg, ...args] = params;
    this.logger.error(msg, ...args);
  }

  fatal(...params: Parameters<LogFn>): void {
    const [msg, ...args] = params;
    this.logger.fatal(msg, ...args);
  }

  child(bindings: Bindings): pino.Logger {
    return this.logger.child(bindings);
  }

  setLevel(level: string): void {
    this.logger.level = level;
  }
}
