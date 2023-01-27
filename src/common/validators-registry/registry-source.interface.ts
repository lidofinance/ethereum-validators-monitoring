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

export interface RegistrySource {
  update(...args): Promise<void>;
  getOperatorsMap(): Map<number, RegistrySourceOperator>;
  getOperatorKey(pubKey: string): RegistrySourceKey | null;
  sourceTimestamp(): Promise<number>;
}
