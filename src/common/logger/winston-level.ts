import { LogLevel } from 'common/config/interfaces';

/**
 * LOG_LEVEL accepts syslog names, winston understands npm ones. Passed straight through, `warning`
 * and `notice` match no winston level and the logger drops every line — a deployment set to either
 * of them logs nothing at all.
 */
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
