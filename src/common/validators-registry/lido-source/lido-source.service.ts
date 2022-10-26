import { LIDO_CONTRACT_TOKEN, Lido } from '@lido-nestjs/contracts';
import {
  RegistryKeyStorageService,
  RegistryMetaStorageService,
  RegistryOperator,
  RegistryOperatorStorageService,
  ValidatorRegistryService,
} from '@lido-nestjs/registry';
import { Inject, Injectable } from '@nestjs/common';

import { RegistrySource, RegistrySourceKeyWithOperatorName, RegistrySourceKeysIndexed } from '../registry-source.interface';

@Injectable()
export class LidoSourceService implements RegistrySource {
  constructor(
    @Inject(LIDO_CONTRACT_TOKEN) public contract: Lido,

    protected readonly validatorService: ValidatorRegistryService,
    protected readonly keyStorageService: RegistryKeyStorageService,
    protected readonly metaStorageService: RegistryMetaStorageService,
    protected readonly operatorStorageService: RegistryOperatorStorageService,
  ) {}

  public async update() {
    await this.validatorService.update('latest');
  }

  public async getIndexedKeys() {
    const indexedKeys: any = new Map<string, RegistrySourceKeyWithOperatorName>();
    await this.updateOperatorsMap(); // Update cached data to quick access
    const allKeys = await this.getKeys();
    for (const k of allKeys ?? []) {
      indexedKeys.set(k.key, { ...k, operatorName: this.operatorsMap[k.operatorIndex].name });
    }
    return indexedKeys as RegistrySourceKeysIndexed;
  }

  public async getKeys() {
    return await this.keyStorageService.findUsed();
  }

  public async sourceTimestamp() {
    const meta = await this.metaStorageService.get();
    return meta?.timestamp;
  }

  public async getOperators() {
    return await this.operatorStorageService.findAll();
  }

  protected operatorsMap: Record<number, RegistryOperator> = {};

  /**
   * Updates cached operators map
   */
  protected async updateOperatorsMap(): Promise<void> {
    const operators = await this.getOperators();

    this.operatorsMap = operators?.reduce((operatorsMap, operator) => {
      operatorsMap[operator.index] = operator;
      return operatorsMap;
    }, {});
  }
}
