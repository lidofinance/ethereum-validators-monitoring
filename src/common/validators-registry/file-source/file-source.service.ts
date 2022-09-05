import { Injectable } from '@nestjs/common';
import {
  RegistrySource,
  RegistrySourceKey,
  RegistrySourceKeysIndexed,
  RegistrySourceKeyWithOperatorName,
  RegistrySourceOperator,
} from '../registry-source.interface';
import { ConfigService } from '../../config';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';

interface FileContent {
  operators: {
    name: string;
    keys: string[];
  }[];
}

@Injectable()
export class FileSourceService implements RegistrySource {
  constructor(protected readonly configService: ConfigService) {}

  protected data: FileContent;

  public async update() {
    const fileContent = readFileSync(this.configService.get('VALIDATOR_REGISTRY_FILE_SOURCE_PATH'), 'utf-8');
    this.data = <FileContent>load(fileContent);
  }

  public async getIndexedKeys() {
    const indexedKeys: any = new Map<string, RegistrySourceKeyWithOperatorName>();
    const allKeys = await this.getKeys();
    for (const k of allKeys ?? []) {
      indexedKeys.set(k.key, { ...k, operatorName: this.data.operators[k.operatorIndex].name });
    }
    return indexedKeys as RegistrySourceKeysIndexed;
  }

  public async getKeys() {
    const keys: RegistrySourceKey[] = [];
    this.data.operators.map((o, operatorIndex) =>
      keys.push(
        ...o.keys.map((key, index) => {
          return { index, operatorIndex, key };
        }),
      ),
    );
    return keys;
  }

  public async sourceTimestamp() {
    return Date.now();
  }

  public async getOperators(): Promise<RegistrySourceOperator[]> {
    return this.data.operators.map((o, index) => {
      return {
        index,
        name: o.name,
        totalSigningKeys: o.keys.length,
        usedSigningKeys: o.keys.length,
      };
    });
  }
}
