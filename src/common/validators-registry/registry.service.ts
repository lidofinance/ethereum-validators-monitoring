import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { PrometheusService, TrackTask } from 'common/prometheus';

import { REGISTRY_SOURCE, RegistrySource, RegistrySourceKeysIndexed } from './registry-source.interface';

@Injectable()
export class RegistryService {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    @Inject(REGISTRY_SOURCE) public readonly source: RegistrySource,
    protected readonly prometheus: PrometheusService,
  ) {}

  public async getActualKeysIndexed(timestamp: number): Promise<RegistrySourceKeysIndexed | undefined> {
    await this.updateValidators();
    if (timestamp > this.lastTimestamp) {
      this.logger.warn(`Registry data is too old. Last update - ${new Date(this.lastTimestamp).toISOString()}`);
    }
    return await this.source.getIndexedKeys();
  }

  public async getOperators() {
    return await this.source.getOperators();
  }

  protected lastTimestamp = 0;

  /**
   * Collects updates from source validators registry contract and saves the changes to the database
   */
  @TrackTask('update-validators')
  protected async updateValidators(): Promise<void> {
    try {
      await this.source.update();
      await this.updateTimestamp();
    } catch (error) {
      // Here we can get a timeout error or something else
      this.logger.warn('Failed to update validators');
      const curr = await this.source.getKeys();
      if (curr?.length == 0) {
        // throw error and run main cycle again
        throw error;
      } else {
        // print error and continue to use current keys from storage
        this.logger.error(error.error?.reason ?? error);
      }
    }
  }

  /**
   * Updates timestamp of last source validators registry update
   */
  protected async updateTimestamp() {
    const source = await this.source.sourceTimestamp();
    this.lastTimestamp = source ?? this.lastTimestamp;
  }
}
