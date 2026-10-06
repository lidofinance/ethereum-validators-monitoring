import { LogLevel } from 'common/config/interfaces';

import { toWinstonLevel } from './winston-level';

describe('toWinstonLevel', () => {
  test('the syslog names LOG_LEVEL accepts map onto levels winston knows', () => {
    // Passed through unmapped, `warning` and `notice` match no winston level and every line is
    // dropped — the app logs nothing at all, which is how this was found.
    expect(toWinstonLevel(LogLevel.warning)).toBe('warn');
    expect(toWinstonLevel(LogLevel.notice)).toBe('info');
  });

  test('the names winston shares with syslog are unchanged', () => {
    expect(toWinstonLevel(LogLevel.error)).toBe('error');
    expect(toWinstonLevel(LogLevel.info)).toBe('info');
    expect(toWinstonLevel(LogLevel.debug)).toBe('debug');
  });
});
