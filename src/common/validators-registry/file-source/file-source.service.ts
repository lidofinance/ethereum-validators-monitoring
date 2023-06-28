import { readFile } from 'fs/promises';

import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { load } from 'js-yaml';

import { ConfigService } from 'common/config';

import { RegistrySource, RegistrySourceKey, RegistrySourceOperator } from '../registry-source.interface';

interface FileContent {
  operators: {
    name: string;
    keys: string[];
  }[];
}

const isValid = (data) => {
  let valid = false;
  data?.operators?.map((o) => {
    o.name && o.keys?.length ? (valid = true) : (valid = false);
  });
  return valid;
};

@Injectable()
export class FileSourceService implements RegistrySource {
  constructor(@Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService, protected readonly configService: ConfigService) {}

  protected data: FileContent;
  protected lastSuccessDataReadTimestamp: number;

  protected operatorsMap = new Map<string, RegistrySourceOperator>();

  protected keysMap = new Map<string, RegistrySourceKey>();

  public async update() {
    const fileContent = await readFile(this.configService.get('VALIDATOR_REGISTRY_FILE_SOURCE_PATH'), 'utf-8');
    const data = <FileContent>load(fileContent);
    if (!isValid(data)) throw new Error('Error when parsing validators registry file source');
    this.logger.log(
      `Successful reading validators registry file source.\n${Object.values(data)
        .map((m, index) => `Module: ${index} | ` + m.map((o) => `${o.name}: [${o.keys.length}]`))
        .join('\n')}`,
    );
    this.lastSuccessDataReadTimestamp = Date.now();
    this.data = data;
    this.updateOperatorsMap();
    this.updateKeysMap();
  }

  public getOperatorsMap() {
    return this.operatorsMap;
  }

  public getOperatorKey(pubKey: string) {
    return this.keysMap.get(pubKey);
  }

  public async sourceTimestamp() {
    return this.lastSuccessDataReadTimestamp;
  }

  protected updateOperatorsMap() {
    this.operatorsMap = new Map<string, RegistrySourceOperator>();
    Object.values(this.data).forEach((m, moduleIndex) => {
      m.forEach((o, operatorIndex) => {
        this.operatorsMap.set(`${moduleIndex + 1}_${operatorIndex}`, { index: operatorIndex, module: moduleIndex + 1, name: o.name });
      });
    });
  }

  protected updateKeysMap() {
    this.keysMap = new Map<string, RegistrySourceKey>();
    Object.values(this.data).forEach((m, moduleIndex) => {
      m.forEach((o, operatorIndex) => {
        if (o.keys) {
          o.keys.forEach((key) => {
            this.keysMap.set(key, { moduleIndex: moduleIndex + 1, operatorIndex, key });
          });
        }
      });
    });
  }
}
