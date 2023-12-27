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

export enum DencunForkEpoch {
  /**
   * @todo This should be corrected once the particular epoch of the Dencun hard fork on Mainnet is known.
   */
  Mainnet = 300000,
  Goerli = 231680,
  Holesky = 29696,
}
