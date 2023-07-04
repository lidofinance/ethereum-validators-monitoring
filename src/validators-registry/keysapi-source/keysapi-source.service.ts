import { Injectable } from '@nestjs/common';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { batch } from 'stream-json/utils/Batch';

import { unblock } from 'common/functions/unblock';

import { RegistrySource, RegistrySourceKey, RegistrySourceOperator } from '../registry-source.interface';
import { KeysapiSourceClient } from './keysapi-source.client';

@Injectable()
export class KeysapiSourceService implements RegistrySource {
  constructor(protected readonly client: KeysapiSourceClient) {}

  protected modules = new Map<string, number>();
  protected operatorsMap = new Map<string, RegistrySourceOperator>();
  protected keysMap = new Map<string, RegistrySourceKey>();
  protected keysOpIndex = 0;

  protected status = undefined;

  public async update() {
    const nonce = await this.getModulesNonceSum();
    if (this.keysOpIndex == 0 || nonce > this.keysOpIndex) {
      await this.updateOperatorsMap();
      await this.updateKeysMap();
      this.keysOpIndex = nonce;
    }
  }

  public getOperatorsMap(): Map<string, RegistrySourceOperator> {
    return this.operatorsMap;
  }

  public getOperatorKey(pubKey: string) {
    return this.keysMap.get(pubKey);
  }

  public async sourceTimestamp() {
    const status = await this.client.getStatus();
    return status.elBlockSnapshot.timestamp;
  }

  protected async getModulesNonceSum() {
    const modules = await this.client.getModules();
    return modules.reduce((acc, m) => acc + m.nonce, 0);
  }

  protected async updateOperatorsMap() {
    const operators = await this.client.getOperators();
    const pipeline = chain([
      operators,
      parser(),
      pick({ filter: 'data' }),
      streamArray(),
      batch({ batchSize: 100 }),
      async (batch) => {
        await unblock();
        for (const data of batch) {
          for (const operator of data.value.operators) {
            this.operatorsMap.set(`${data.value.module.id}_${operator.index}`, {
              index: operator.index,
              module: data.value.module.id,
              name: operator.name,
            });
            if (!this.modules.has(data.value.module.stakingModuleAddress)) {
              this.modules.set(data.value.module.stakingModuleAddress, +data.value.module.id);
            }
          }
        }
      },
    ]);
    pipeline.on('data', (data) => data);
    await new Promise((resolve, reject) => {
      pipeline.on('error', (error) => reject(error));
      pipeline.on('end', () => resolve(true));
    }).finally(() => pipeline.destroy());
  }

  protected async updateKeysMap() {
    this.keysMap = new Map();
    const keys = await this.client.getUsedKeys();
    const pipeline = chain([
      keys,
      parser(),
      pick({ filter: 'data' }),
      streamArray(),
      batch({ batchSize: 100 }),
      async (batch) => {
        await unblock();
        for (const data of batch) {
          this.keysMap.set(data.value.key, {
            key: data.value.key,
            operatorIndex: +data.value.operatorIndex,
            moduleIndex: this.modules.get(data.value.moduleAddress),
          });
        }
      },
    ]);
    pipeline.on('data', (data) => data);
    await new Promise((resolve, reject) => {
      pipeline.on('error', (error) => reject(error));
      pipeline.on('end', () => resolve(true));
    }).finally(() => pipeline.destroy());
  }
}
