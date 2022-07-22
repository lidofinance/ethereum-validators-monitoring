import { ConfigService as ConfigServiceSource } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

export class ConfigService extends ConfigServiceSource<EnvironmentVariables> {
  /**
   * List of env variables that should be hidden
   */
  public get secrets(): string[] {
    return [
      this.get('ETH1_RPC_URL'),
      this.get('ETH1_RPC_URL_BACKUP'),
      this.get('ETH2_BEACON_RPC_URL'),
      this.get('ETH2_BEACON_RPC_URL_BACKUP'),
    ]
      .filter((v) => v)
      .map((v) => String(v));
  }

  public get<T extends keyof EnvironmentVariables>(key: T): EnvironmentVariables[T] {
    return super.get(key, { infer: true }) as EnvironmentVariables[T];
  }
}
