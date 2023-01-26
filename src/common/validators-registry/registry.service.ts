import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { PrometheusService, TrackTask } from 'common/prometheus';

import { REGISTRY_SOURCE, RegistrySource, RegistrySourceKeyWithOperatorName } from './registry-source.interface';

@Injectable()
export class RegistryService {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    @Inject(REGISTRY_SOURCE) public readonly source: RegistrySource,
    protected readonly prometheus: PrometheusService,
  ) {}

  protected lastTimestamp = 0;

  protected operators = [];

  @TrackTask('update-validators')
  public async updateKeysRegistry(timestamp: number): Promise<void> {
    await this.source.update();
    await this.updateTimestamp();
    if (timestamp > this.lastTimestamp) {
      const lastUpdateTime = new Date(this.lastTimestamp * 1000).toISOString();
      throw Error(`Validators registry data is too old. Last update - ${lastUpdateTime}`);
    }
    this.operators = [...this.source.getOperatorsMap().values()];
  }

  public getOperatorKey(pubKey: string): RegistrySourceKeyWithOperatorName {
    const key = this.source.getOperatorKey(pubKey);
    if (!key) return null;
    const operator = this.source.getOperatorsMap().get(key.operatorIndex);
    return { ...key, operatorName: operator.name };
  }

  public getOperators() {
    return this.operators;
  }

  /**
   * Updates timestamp of last source validators registry update
   */
  protected async updateTimestamp() {
    const source = await this.source.sourceTimestamp();
    this.lastTimestamp = source ?? this.lastTimestamp;
  }
}
