import { ConfigService as ConfigServiceSource } from '@nestjs/config';

import { EnvironmentVariables } from './env.validation';
import { CriticalAlertParamsForModule } from './interfaces';

export class ConfigService extends ConfigServiceSource<EnvironmentVariables> {
  /**
   * List of env variables that should be hidden
   */
  public get secrets(): string[] {
    return [...this.get('EL_RPC_URLS'), ...this.get('CL_API_URLS'), this.get('DB_PASSWORD')].filter((v) => v).map((v) => String(v));
  }

  public get<T extends keyof EnvironmentVariables>(key: T): EnvironmentVariables[T] {
    return super.get(key, { infer: true }) as EnvironmentVariables[T];
  }

  public getCriticalAlertParamForModule(moduleIndex: number): CriticalAlertParamsForModule {
    const minValCount = this.get('CRITICAL_ALERTS_MIN_VAL_COUNT');
    const minActiveValCount = this.get('CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT');
    const minAffectedValCount = this.get('CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT');

    if (minAffectedValCount[moduleIndex] != null) {
      return {
        affectedValCount: minAffectedValCount[moduleIndex],
      };
    }

    if (minActiveValCount[moduleIndex] != null) {
      return {
        activeValCount: minActiveValCount[moduleIndex],
      };
    }

    if (minAffectedValCount[0] != null) {
      return {
        affectedValCount: minAffectedValCount[0],
      };
    }

    if (minActiveValCount[0] != null) {
      return {
        activeValCount: minActiveValCount[0],
      };
    }

    return {
      activeValCount: {
        minActiveCount: minValCount,
        affectedShare: 0.33,
        minAffectedCount: 1000,
      },
    };
  }
}
