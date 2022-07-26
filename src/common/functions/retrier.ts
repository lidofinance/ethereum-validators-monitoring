import { LoggerService } from '@nestjs/common';

import { sleep } from './sleep';

export const retrier = (
  logger: LoggerService,
  defaultMaxRetryCount = 3,
  defaultMinBackoffMs = 1000,
  defaultMaxBackoffMs = 60000,
  defaultLogWarning = false,
) => {
  return async <T>(
    callback: () => Promise<T>,
    maxRetryCount?: number,
    minBackoffMs?: number,
    maxBackoffMs?: number,
    logWarning?: boolean,
  ): Promise<T> => {
    maxRetryCount = maxRetryCount ?? defaultMaxRetryCount;
    minBackoffMs = minBackoffMs ?? defaultMinBackoffMs;
    maxBackoffMs = maxBackoffMs ?? defaultMaxBackoffMs;
    logWarning = logWarning ?? defaultLogWarning;
    try {
      return await callback();
    } catch (err: any) {
      if (maxRetryCount <= 1 || minBackoffMs >= maxBackoffMs) {
        throw err;
      }
      if (logWarning) {
        logger.warn(err, `Retrying after (${minBackoffMs}ms). Remaining retries [${maxRetryCount}]`);
      }
      await sleep(minBackoffMs);
      return await retrier(logger)(callback, maxRetryCount - 1, minBackoffMs * 2, maxBackoffMs, logWarning);
    }
  };
};
