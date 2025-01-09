import { readFile } from 'fs/promises';

import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { load } from 'js-yaml';

import { ConfigService } from 'common/config';
import { PrometheusService, TrackTask } from 'common/prometheus';

import { REGISTRY_SOURCE, RegistrySource, RegistrySourceKeyWithOperatorName } from './registry-source.interface';

interface StuckValidatorsFileContent {
  keys: string[];
}

@Injectable()
export class RegistryService {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    @Inject(REGISTRY_SOURCE) public readonly source: RegistrySource,
    protected readonly prometheus: PrometheusService,
    protected readonly config: ConfigService,
  ) {}

  protected lastTimestamp = 0;

  protected operators = [];
  protected stuckKeys = [];

  @TrackTask('update-validators')
  public async updateKeysRegistry(timestamp: number): Promise<void> {
    this.logger.log('Updating validators registry data');
    const tasks = await Promise.all([
      this.source.update(),
      this.config.get('VALIDATOR_USE_STUCK_KEYS_FILE') ? this.readStuckKeysFile() : (() => [])(),
    ]);
    this.stuckKeys = tasks[1];
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
    const operator = this.source.getOperatorsMap().get(`${key.moduleIndex}_${key.operatorIndex}`);
    return { ...key, operatorName: operator.name };
  }

  public getOperators() {
    return this.operators;
  }

  public getStuckKeys() {
    return this.stuckKeys;
  }

  public isFilled() {
    return this.lastTimestamp > 0;
  }

  /**
   * Returns keys of validators that are stuck and will not be monitored
   * */
  protected async readStuckKeysFile(): Promise<string[]> {
    try {
      this.logger.debug(`Reading stuck validators file: ${this.config.get('VALIDATOR_STUCK_KEYS_FILE_PATH')}`);
      const fileContent = await readFile(this.config.get('VALIDATOR_STUCK_KEYS_FILE_PATH'), 'utf-8');
      const data = <StuckValidatorsFileContent>load(fileContent);
      return data.keys;
    } catch (e) {
      this.logger.error(`Error while reading stuck validators file: ${e.message}`);
      return [];
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
