export enum Environment {
  development = 'development',
  production = 'production',
  staging = 'staging',
  testnet = 'testnet',
  test = 'test',
}

export enum LogLevel {
  error = 'error',
  warning = 'warning',
  notice = 'notice',
  info = 'info',
  debug = 'debug',
}

export enum LogFormat {
  json = 'json',
  simple = 'simple',
}

export interface CriticalAlertParamsForModule {
  activeValCount?: {
    minActiveCount: number;
    affectedShare: number;
    minAffectedCount: number;
  };
  affectedValCount?: number;
}
