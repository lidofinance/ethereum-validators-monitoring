import { Transform, plainToInstance } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsPort,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

import { DEFAULT_SECRETS_FILE_PATH, DEFAULT_SECRETS_POLL_INTERVAL_IN_SECONDS, readSecretsFile } from 'common/secrets/secrets-file';

import { Environment, LogFormat, LogLevel } from './interfaces';

export enum Network {
  Mainnet = 1,
  Goerli = 5,
  Holesky = 17000,
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

const toBoolean = (value: any): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return !!value;
  }

  if (!(typeof value === 'string')) {
    return false;
  }

  switch (value.toLowerCase().trim()) {
    case 'true':
    case 'yes':
    case '1':
      return true;
    case 'false':
    case 'no':
    case '0':
    case null:
      return false;
    default:
      return false;
  }
};

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.development;

  @IsNumber()
  @Min(1025)
  @Max(65535)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public HTTP_PORT = 8080;

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.info;

  @IsEnum(LogFormat)
  LOG_FORMAT: LogFormat = LogFormat.json;

  @IsBoolean()
  @Transform(({ value }) => toBoolean(value), { toClassOnly: true })
  public DRY_RUN = false;

  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @ValidateIf((vars) => vars.NODE_ENV != Environment.test)
  public DB_HOST!: string;

  @IsString()
  @MinLength(3)
  @ValidateIf((vars) => vars.NODE_ENV != Environment.test)
  public DB_USER!: string;

  @IsString()
  @MinLength(0)
  @ValidateIf((vars) => vars.NODE_ENV != Environment.test)
  public DB_PASSWORD!: string;

  @IsNotEmpty()
  @MinLength(1)
  @ValidateIf((vars) => vars.NODE_ENV != Environment.test)
  public DB_NAME!: string;

  @IsPort()
  public DB_PORT = '8123';

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public DB_MAX_RETRIES = 10;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public DB_MIN_BACKOFF_SEC = 1;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public DB_MAX_BACKOFF_SEC = 120;

  /**
   * Create ClickHouse tables with the Replicated* table engine family.
   * Enable it only when the target database is backed by a replicated cluster.
   */
  @IsBoolean()
  @Transform(({ value }) => toBoolean(value), { toClassOnly: true })
  public DB_CLICKHOUSE_REPLICATED = false;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5000000)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ETH_NETWORK!: Network;

  @IsArray()
  @ArrayMinSize(1)
  @Transform(({ value }) => value.split(','))
  @ValidateIf((vars) => vars.VALIDATOR_REGISTRY_SOURCE == ValidatorRegistrySource.Lido && vars.NODE_ENV != Environment.test)
  public EL_RPC_URLS: string[] = [];

  @IsArray()
  @ArrayMinSize(1)
  @Transform(({ value }) => value.split(','))
  @ValidateIf((vars) => vars.NODE_ENV != Environment.test)
  public CL_API_URLS!: string[];

  @IsInt()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CL_API_RETRY_DELAY_MS = 500;

  @IsNumber()
  @Min(5000)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CL_API_GET_RESPONSE_TIMEOUT = 15000;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CL_API_MAX_RETRIES = 1;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CL_API_GET_BLOCK_INFO_MAX_RETRIES = 1;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CL_API_MAX_SLOT_DEEP_COUNT = 32;

  @IsBoolean()
  @Transform(({ value }) => toBoolean(value), { toClassOnly: true })
  public SPARSE_NETWORK_MODE = false;

  @IsNumber()
  @Min(74240) // Altair
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  @ValidateIf((vars) => vars.ETH_NETWORK === Network.Mainnet)
  public START_EPOCH = 155000;

  @IsNumber()
  @Min(32)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public FETCH_INTERVAL_SLOTS = 32;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CHAIN_SLOT_TIME_SECONDS = 12;

  @IsEnum(ValidatorRegistrySource)
  public VALIDATOR_REGISTRY_SOURCE: ValidatorRegistrySource = ValidatorRegistrySource.Lido;

  @IsString()
  public VALIDATOR_REGISTRY_FILE_SOURCE_PATH = './docker/validators/custom_mainnet.yaml';

  @IsString()
  public VALIDATOR_REGISTRY_LIDO_SOURCE_SQLITE_CACHE_PATH = './docker/validators/lido_mainnet.db';

  @IsArray()
  @ArrayMinSize(1)
  @Transform(({ value }) => value.split(','))
  @ValidateIf((vars) => vars.VALIDATOR_REGISTRY_SOURCE == ValidatorRegistrySource.KeysAPI && vars.NODE_ENV != Environment.test)
  public VALIDATOR_REGISTRY_KEYSAPI_SOURCE_URLS!: string[];

  @IsInt()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RETRY_DELAY_MS = 500;

  @IsNumber()
  @Min(5000)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RESPONSE_TIMEOUT = 30000;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public VALIDATOR_REGISTRY_KEYSAPI_SOURCE_MAX_RETRIES = 2;

  /**
   * Use a file with list of validators that are stuck and should be excluded from the monitoring metrics
   */
  @IsBoolean()
  @Transform(({ value }) => toBoolean(value), { toClassOnly: true })
  public VALIDATOR_USE_STUCK_KEYS_FILE = false;

  /**
   * Path to file with list of validators that are stuck and should be excluded from the monitoring metrics
   */
  @IsString()
  public VALIDATOR_STUCK_KEYS_FILE_PATH = './docker/validators/stuck_keys.yaml';

  /**
   * Distance (down) from Blockchain Sync Participation average after which we think that our sync participation is bad
   * For example:
   *  Blockchain Sync participation = 99%
   *  User validator 1 = 78%
   *  User validator 2 = 98%
   *  DISTANCE_DOWN_FROM_CHAIN_SYNC_PARTICIPATION = 10
   *  Validator 1 participation is bad, because 78 < (99 - 10)
   *  Validator 2 participation is ok, because 98 > (99 - 10)
   */
  @IsNumber()
  @Min(0)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG = 0;

  /**
   * Number epochs after which we think that our sync participation is bad and alert about that
   * For example:
   *  Our validator have bad participation in 3 epoch in a row
   *  SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG = 3
   *  Then we alert about that
   */
  @IsNumber()
  @Min(1)
  @Max(10)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG = 3;

  /**
   * Number epochs after which we think that our attestation is bad and alert about that
   * For example:
   *  Our validator have bad attestation in 3 epoch in a row
   *  BAD_ATTESTATION_EPOCHS = 3
   *  Then we alert about that
   */
  @IsNumber()
  @Min(1)
  @Max(10)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public BAD_ATTESTATION_EPOCHS = 3;

  /**
   * Critical alerts will be sent for NOs with validators count greater this value
   */
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CRITICAL_ALERTS_MIN_VAL_COUNT = 100;

  @IsObject()
  @Transform(({ value }) => JSON.parse(value), { toClassOnly: true })
  public CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT = {};

  @IsObject()
  @Transform(({ value }) => JSON.parse(value), { toClassOnly: true })
  public CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT = {};

  @IsObject()
  @Transform(({ value }) => JSON.parse(value), { toClassOnly: true })
  public CRITICAL_ALERTS_MIN_ACTIVE_VAL_BALANCE = {};

  @IsObject()
  @Transform(({ value }) => JSON.parse(value), { toClassOnly: true })
  public CRITICAL_ALERTS_MIN_AFFECTED_VAL_BALANCE = {};

  @IsString()
  public CRITICAL_ALERTS_ALERTMANAGER_URL = '';

  /**
   * Additional labels for critical alerts. Must be in JSON string format.
   * For example - '{"a":"valueA","b":"valueB"}'
   */
  @IsObject()
  @Transform(({ value }) => JSON.parse(value), { toClassOnly: true })
  public CRITICAL_ALERTS_ALERTMANAGER_LABELS = {};

  @IsEnum(WorkingMode)
  public WORKING_MODE = WorkingMode.Finalized;

  /** File the secrets are read from. Absent means the values come from the environment. */
  @IsString()
  public SECRETS_FILE_PATH = DEFAULT_SECRETS_FILE_PATH;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public SECRETS_POLL_INTERVAL_IN_SECONDS = DEFAULT_SECRETS_POLL_INTERVAL_IN_SECONDS;

  /** How long a shutdown waits for the epoch in flight. Keep it under terminationGracePeriodSeconds. */
  @IsInt()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public SHUTDOWN_TIMEOUT_IN_SECONDS = 25;
}

export function validate(config: Record<string, unknown>) {
  // The file wins over the environment, merged here so its values pass the same validation.
  // The logger does not exist yet at this point, hence console.
  const secretsFilePath = String(config.SECRETS_FILE_PATH ?? DEFAULT_SECRETS_FILE_PATH);
  const withSecrets = { ...config, ...readSecretsFile(secretsFilePath, (message) => console.error(message)) };

  const validatedConfig = plainToInstance(EnvironmentVariables, withSecrets);

  const validatorOptions = { skipMissingProperties: false };
  const errors = validateSync(validatedConfig, validatorOptions);

  if (errors.length > 0) {
    console.error(errors.toString());
    process.exit(1);
  }

  return validatedConfig;
}
