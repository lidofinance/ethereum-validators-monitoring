import * as v8 from 'v8';

import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckError, HealthCheckService, HealthIndicatorResult, MemoryHealthIndicator } from '@nestjs/terminus';

import { ClickhouseService } from 'storage/clickhouse';

import { HEALTH_READY_URL, HEALTH_URL } from './health.constants';

// No cache or throttle interceptor is registered in this app, so neither probe needs a skip
// decorator — a probe served from a response cache keeps answering 200 through an outage of the
// thing it checks.
@Controller(HEALTH_URL)
export class HealthController {
  private readonly maxHeapSize: number;
  constructor(private health: HealthCheckService, private memory: MemoryHealthIndicator, private clickhouse: ClickhouseService) {
    this.maxHeapSize = v8.getHeapStatistics().heap_size_limit;
  }

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([async () => this.memory.checkHeap('memoryHeap', this.maxHeapSize)]);
  }

  /**
   * ClickHouse is the one hard dependency this process owns: without it an epoch can be read but
   * not stored.
   *
   * Note which probe reads this. Kubernetes readiness stays on /health, because the indexer is
   * scraped through its Service and a pod dropped from the endpoints stops being scraped — a
   * ClickHouse outage would take the indexer's own metrics with it, exactly when they are needed.
   */
  @Get(HEALTH_READY_URL)
  @HealthCheck()
  ready() {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.clickhouse.ping();
        } catch {
          // The reason is not carried into the response: a client error names the connection, which
          // is where the database credentials are. It is in the log, redacted, either way.
          throw new HealthCheckError('ClickHouse is not reachable', { clickhouse: { status: 'down' } });
        }

        return { clickhouse: { status: 'up' } };
      },
    ]);
  }
}
