import { LIDO_CONTRACT_TOKEN, Lido } from '@lido-nestjs/contracts';
import {
  RegistryKeyStorageService,
  RegistryMetaStorageService,
  RegistryOperatorStorageService,
  ValidatorRegistryService,
} from '@lido-nestjs/registry';
import { Inject, Injectable } from '@nestjs/common';

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

  protected operatorsMap = new Map<number, RegistrySourceOperator>();
  protected keysMap = new Map<string, RegistrySourceKey>();
  protected keysOpIndex = 0;

  public async update() {
    await this.validatorService.update('latest');
    await this.updateOperatorsMap();
    const storageKeysOpIndex = (await this.metaStorageService.get())?.keysOpIndex;
    if (this.keysOpIndex == 0 || storageKeysOpIndex > this.keysOpIndex) {
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
    this.operatorsMap = new Map(operators.map((o) => [o.index, o]));
  }

  protected async updateKeysMap() {
    const allKeys = await this.keyStorageService.findUsed();
    this.keysMap = new Map(allKeys.map((k) => [k.key, k]));
  }
}
