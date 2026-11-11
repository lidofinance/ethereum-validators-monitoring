import { NonEmptyArray, SimpleFallbackProviderConfig } from '@lido-nestjs/execution';

import { USER_AGENT } from 'app/app.constants';
import { PrometheusService } from 'common/prometheus';

import { createExecutionFetchMiddleware } from './execution-provider.middleware';

export function executionProviderConfig(
  [first, ...rest]: NonEmptyArray<string>,
  network: number,
  prometheusService: PrometheusService,
): SimpleFallbackProviderConfig {
  // The header goes in here: the provider freezes its connection once built.
  const withAgent = (url: string) => ({ url, headers: { 'User-Agent': USER_AGENT } });

  return {
    urls: [withAgent(first), ...rest.map(withAgent)],
    network,
    fetchMiddlewares: [createExecutionFetchMiddleware(prometheusService)],
  };
}
