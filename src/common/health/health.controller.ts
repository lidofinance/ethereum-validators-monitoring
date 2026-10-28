import * as v8 from 'v8';

import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckError, HealthCheckService, HealthIndicatorResult, MemoryHealthIndicator } from '@nestjs/terminus';

import { ClickhouseService } from 'storage/clickhouse';

import { HEALTH_READY_URL, HEALTH_URL } from './health.constants';

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

  /** Whether ClickHouse answers. Not meant to take the instance out of service: its metrics are
   * needed most while the database is down. */
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
