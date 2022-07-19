import pino, { Bindings, LogFn } from 'pino';
import { createInterface }       from '../common/functions/createInterface';

export const ILogger = createInterface<ILogger>('ILogger');

export interface ILogger {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;

  child(bindings: Bindings): pino.Logger;

  setLevel(level: string): void;
}
