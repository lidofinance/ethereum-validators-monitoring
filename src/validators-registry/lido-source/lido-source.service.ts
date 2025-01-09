import { LIDO_CONTRACT_TOKEN, Lido } from '@lido-nestjs/contracts';
import {
  RegistryKeyStorageService,
  RegistryMetaStorageService,
  RegistryOperatorStorageService,
  ValidatorRegistryService,
} from '@lido-nestjs/registry';
import { Inject, Injectable } from '@nestjs/common';

import { unblock } from 'common/functions/unblock';

import { RegistrySource, RegistrySourceKey, RegistrySourceOperator } from '../registry-source.interface';

@Injectable()
export class LidoSourceService implements RegistrySource {
  constructor(
    @Inject(LIDO_CONTRACT_TOKEN) public contract: Lido,

    protected readonly validatorService: ValidatorRegistryService,
    protected readonly keyStorageService: RegistryKeyStorageService,
    protected readonly metaStorageService: RegistryMetaStorageService,
    protected readonly operatorStorageService: RegistryOperatorStorageService,
  ) {}

  protected registryModuleId = 1; // stub for now
  protected operatorsMap = new Map<string, RegistrySourceOperator>();
  protected keysMap = new Map<string, RegistrySourceKey>();
  protected keysOpIndex = 0;

  public async update() {
    await this.validatorService.update('latest');
    const storageKeysOpIndex = (await this.metaStorageService.get())?.keysOpIndex;
    if (this.keysOpIndex == 0 || storageKeysOpIndex > this.keysOpIndex) {
      await this.updateOperatorsMap();
      await this.updateKeysMap();
      this.keysOpIndex = storageKeysOpIndex;
    }
  }

  public getOperatorsMap() {
    return this.operatorsMap;
  }

  public getOperatorKey(pubKey: string) {
    return this.keysMap.get(pubKey);
  }

  public async sourceTimestamp() {
    const meta = await this.metaStorageService.get();
    return meta?.timestamp;
  }

  protected async updateOperatorsMap() {
    const operators = await this.operatorStorageService.findAll();
    this.operatorsMap = new Map(operators.map((o) => [`${this.registryModuleId}_${o.index}`, { ...o, module: this.registryModuleId }]));
  }

  protected async updateKeysMap() {
    this.keysMap = new Map();
    for (const operator of this.operatorsMap.values()) {
      const operatorKeys = await this.keyStorageService.findByOperatorIndex(operator.index);
      for (const key of operatorKeys) {
        if (key.used) this.keysMap.set(key.key, { key: key.key, operatorIndex: key.operatorIndex, moduleIndex: this.registryModuleId });
      }
      await unblock();
    }
  }
}
