import { LogLevel } from 'common/config/interfaces';

/** `warning` and `notice` are syslog names that match no winston level: passed through unmapped,
 * the logger drops every line. */
const WINSTON_LEVELS: Record<LogLevel, string> = {
  [LogLevel.error]: 'error',
  [LogLevel.warning]: 'warn',
  [LogLevel.notice]: 'info',
  [LogLevel.info]: 'info',
  [LogLevel.debug]: 'debug',
};

export function toWinstonLevel(level: LogLevel): string {
  return WINSTON_LEVELS[level] ?? 'info';
}
