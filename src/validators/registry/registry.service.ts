import { Inject, Injectable, LoggerService } from '@nestjs/common';
import {
  ValidatorRegistryService,
  RegistryKeyStorageService,
  RegistryMetaStorageService,
  RegistryOperatorStorageService,
  RegistryOperator,
  RegistryKey,
} from '@lido-nestjs/registry';
import { PrometheusService } from 'common/prometheus';
import { ConfigService } from 'common/config';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';

export type KeyWithOperatorName = RegistryKey & {
  operatorName: string;
};

export type KeysIndexed = Map<string, KeyWithOperatorName>;

@Injectable()
export class RegistryService {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,

    protected readonly validatorService: ValidatorRegistryService,
    protected readonly keyStorageService: RegistryKeyStorageService,
    protected readonly metaStorageService: RegistryMetaStorageService,
    protected readonly operatorStorageService: RegistryOperatorStorageService,
    protected readonly prometheusService: PrometheusService,
    protected readonly configService: ConfigService,
  ) {}

  /**
   * Collects updates from the registry contract and saves the changes to the database
   */
  public async updateValidators(): Promise<void> {
    await this.prometheusService.trackTask('update-validators', async () => {
      try {
        await this.validatorService.update('latest');
      } catch (error) {
        // Here we can get a timeout error or something else.
        // We just print error and use only well fetched validators,
        // the rest of validators will be fetched at next iteration
        this.logger.error(error.error?.reason ?? error);
      }

      // Update cached data to quick access
      await Promise.all([this.updateTimestamp(), this.updateOperatorsMap()]);
    });
  }

  protected lastTimestamp = 0;
  protected operatorsMap: Record<number, RegistryOperator> = {};

  /**
   * Updates timestamp of the last registry update
   */
  protected async updateTimestamp() {
    const meta = await this.metaStorageService.get();
    this.lastTimestamp = meta?.timestamp ?? this.lastTimestamp;
  }

  /**
   * Updates cached operators map
   */
  protected async updateOperatorsMap(): Promise<void> {
    const operators = await this.operatorStorageService.findAll();

    this.operatorsMap = operators.reduce((operatorsMap, operator) => {
      operatorsMap[operator.index] = operator;
      return operatorsMap;
    }, {});
  }

  public async getAllKeysIndexed(): Promise<KeysIndexed | undefined> {
    await this.updateValidators();
    const indexedKeys: any = new Map<string, KeyWithOperatorName>();
    const allKeys = await this.keyStorageService.findUsed();
    for (const k of allKeys) {
      indexedKeys.set(k.key, { ...k, operatorName: this.operatorsMap[k.operatorIndex].name });
    }
    return indexedKeys as KeysIndexed;
  }

  public async getOperators(): Promise<RegistryOperator[]> {
    return await this.operatorStorageService.findAll();
  }
}
