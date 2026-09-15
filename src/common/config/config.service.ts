import { ConfigService as ConfigServiceSource } from '@nestjs/config';

import { EnvironmentVariables, SECRET_KEYS, URL_KEYS, loggableConfig } from './env.validation';
import { CriticalAlertParamsForModule } from './interfaces';
import { ethToGwei } from '../functions/ethToGwei';

export class ConfigService extends ConfigServiceSource<EnvironmentVariables> {
  /** Values replaced wherever they appear in a log line. Same lists the config dump masks by key,
   * so the two cannot drift. */
  public get secrets(): string[] {
    return [...URL_KEYS, ...SECRET_KEYS]
      .flatMap((key) => this.get(key))
      .filter((v) => v)
      .map((v) => String(v));
  }

  public get loggableConfig(): Record<string, unknown> {
    return loggableConfig((key) => this.get(key));
  }

  public get<T extends keyof EnvironmentVariables>(key: T): EnvironmentVariables[T] {
    return super.get(key, { infer: true }) as EnvironmentVariables[T];
  }

  public getCriticalAlertParamForModule(moduleIndex: number): CriticalAlertParamsForModule {
    const minValCount = this.get('CRITICAL_ALERTS_MIN_VAL_COUNT');
    const minActiveValCount = this.get('CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT');
    const minAffectedValCount = this.get('CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT');
    const minActiveBalance = this.get('CRITICAL_ALERTS_MIN_ACTIVE_VAL_BALANCE');
    const minAffectedBalance = this.get('CRITICAL_ALERTS_MIN_AFFECTED_VAL_BALANCE');

    if (minAffectedBalance[moduleIndex] != null) {
      return {
        affectedValBalance: ethToGwei(minAffectedBalance[moduleIndex]),
      };
    }

    if (minActiveBalance[moduleIndex] != null) {
      return {
        activeValBalance: {
          minActiveBalance: ethToGwei(minActiveBalance[moduleIndex].minActiveBalance),
          affectedShare: minActiveBalance[moduleIndex].affectedShare,
          minAffectedBalance: ethToGwei(minActiveBalance[moduleIndex].minAffectedBalance),
        },
      };
    }

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

    if (minAffectedBalance[0] != null) {
      return {
        affectedValBalance: ethToGwei(minAffectedBalance[0]),
      };
    }

    if (minActiveBalance[0] != null) {
      return {
        activeValBalance: {
          minActiveBalance: ethToGwei(minActiveBalance[0].minActiveBalance),
          affectedShare: minActiveBalance[0].affectedShare,
          minAffectedBalance: ethToGwei(minActiveBalance[0].minAffectedBalance),
        },
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

    // default values if the only CRITICAL_ALERTS_MIN_VAL_COUNT is set
    return {
      activeValCount: {
        minActiveCount: minValCount,
        affectedShare: 0.33,
        minAffectedCount: 1000,
      },
    };
  }
}
