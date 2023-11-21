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

export enum Network {
  Mainnet = 1,
  Goerli = 5,
  Holesky = 17000,
  Kintsugi = 1337702,
}

export enum ValidatorRegistrySource {
  Lido = 'lido',
  File = 'file',
  KeysAPI = 'keysapi',
}

export enum WorkingMode {
  Finalized = 'finalized',
  Head = 'head',
}
