export const REGISTRY_SOURCE = 'validatorsRegistrySourceToken';

export interface RegistrySourceKey {
  index: number;
  operatorIndex: number;
  key: string;
}

export interface RegistrySourceKeyWithOperatorName extends RegistrySourceKey {
  operatorName: string;
}

export interface RegistrySourceOperator {
  index: number;
  name: string;
}

export type RegistrySourceKeysIndexed = Map<string, RegistrySourceKeyWithOperatorName>;

export interface RegistrySource {
  update(...args): Promise<void>;
  getIndexedKeys(): Promise<RegistrySourceKeysIndexed | undefined>;
  getKeys(): Promise<RegistrySourceKey[]>;
  getOperators(): Promise<RegistrySourceOperator[]>;
  sourceTimestamp(): Promise<number>;
}
