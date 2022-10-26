import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';

import { HEALTH_URL } from './health.constants';

@Controller(HEALTH_URL)
export class HealthController {
  constructor(private health: HealthCheckService, private memory: MemoryHealthIndicator) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([async () => this.memory.checkHeap('memoryHeap', 1024 * 1024 * 1024)]);
  }
}
