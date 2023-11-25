import { Transform, plainToInstance } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPort,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

import { Environment, LogFormat, LogLevel, Chain, ValidatorRegistrySource, WorkingMode } from './interfaces';

export class EnvironmentVariables {
  @IsOptional()
  @IsEnum(Environment)
  @Transform(({ value }) => value || Environment.development)
  public NODE_ENV: Environment = Environment.development;

  @IsOptional()
  @IsPort()
  @Transform(({ value }) => value || '8080')
  public HTTP_PORT = '8080';

  @IsOptional()
  @IsEnum(LogLevel)
  @Transform(({ value }) => value || LogLevel.info)
  public LOG_LEVEL: LogLevel = LogLevel.info;

  @IsOptional()
  @IsEnum(LogFormat)
  @Transform(({ value }) => value || LogFormat.json)
  public LOG_FORMAT: LogFormat = LogFormat.json;

  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean({ defaultValue: false }))
  public DRY_RUN = false;

  @ValidateIf((vars) => vars.NODE_ENV !== Environment.test)
  @IsNotEmpty()
  @IsString()
  public DB_HOST!: string;

  @ValidateIf((vars) => vars.NODE_ENV !== Environment.test)
  @IsNotEmpty()
  @IsString()
  public DB_USER!: string;

  @ValidateIf((vars) => vars.NODE_ENV !== Environment.test)
  @IsOptional()
  @IsString()
  public DB_PASSWORD = '';

  @ValidateIf((vars) => vars.NODE_ENV !== Environment.test)
  @IsNotEmpty()
  @IsString()
  public DB_NAME!: string;

  @IsOptional()
  @IsPort()
  @Transform(({ value }) => value || '8123')
  public DB_PORT = '8123';

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 10 }))
  public DB_MAX_RETRIES = 10;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 1 }))
  public DB_MIN_BACKOFF_SEC = 1;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 120 }))
  public DB_MAX_BACKOFF_SEC = 120;

  @ValidateIf((vars) => vars.NODE_ENV !== Environment.test)
  @IsNotEmpty()
  @IsEnum(Chain)
  @Transform(({ value }) => parseInt(value, 10))
  public ETH_NETWORK!: Chain;

  @ValidateIf((vars) => vars.VALIDATOR_REGISTRY_SOURCE === ValidatorRegistrySource.Lido && vars.NODE_ENV !== Environment.test)
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl(
    {
      require_protocol: true,
    },
    {
      each: true,
    },
  )
  @Transform(({ value }) => toArrayOfUrls(value))
  public EL_RPC_URLS: string[] = [];

  @ValidateIf((vars) => vars.NODE_ENV !== Environment.test)
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl(
    {
      require_protocol: true,
    },
    {
      each: true,
    },
  )
  @Transform(({ value }) => toArrayOfUrls(value))
  public CL_API_URLS: string[] = [];

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 500 }))
  public CL_API_RETRY_DELAY_MS = 500;

  @IsOptional()
  @IsInt()
  @Min(5000)
  @Transform(toNumber({ defaultValue: 15000 }))
  public CL_API_GET_RESPONSE_TIMEOUT = 15000;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 1 }))
  public CL_API_MAX_RETRIES = 1;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 1 }))
  public CL_API_GET_BLOCK_INFO_MAX_RETRIES = 1;

  @ValidateIf((vars) => vars.ETH_NETWORK === Chain.Mainnet)
  @IsOptional()
  @IsInt()
  @Min(74240) // Altair
  @Transform(toNumber({ defaultValue: 155000 }))
  public START_EPOCH = 155000;

  @IsOptional()
  @IsInt()
  @Min(32)
  @Transform(toNumber({ defaultValue: 32 }))
  public FETCH_INTERVAL_SLOTS = 32;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 12 }))
  public CHAIN_SLOT_TIME_SECONDS = 12;

  @IsOptional()
  @IsEnum(ValidatorRegistrySource)
  @Transform(({ value }) => value || ValidatorRegistrySource.Lido)
  public VALIDATOR_REGISTRY_SOURCE: ValidatorRegistrySource = ValidatorRegistrySource.Lido;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => value || './docker/validators/custom_mainnet.yaml')
  public VALIDATOR_REGISTRY_FILE_SOURCE_PATH = './docker/validators/custom_mainnet.yaml';

  @IsOptional()
  @IsString()
  @Transform(({ value }) => value || './docker/validators/lido_mainnet.db')
  public VALIDATOR_REGISTRY_LIDO_SOURCE_SQLITE_CACHE_PATH = './docker/validators/lido_mainnet.db';

  @ValidateIf((vars) => vars.VALIDATOR_REGISTRY_SOURCE === ValidatorRegistrySource.KeysAPI && vars.NODE_ENV !== Environment.test)
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl(
    {
      require_protocol: true,
    },
    {
      each: true,
    },
  )
  @Transform(({ value }) => toArrayOfUrls(value))
  public VALIDATOR_REGISTRY_KEYSAPI_SOURCE_URLS: string[] = [];

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 500 }))
  public VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RETRY_DELAY_MS = 500;

  @IsOptional()
  @IsInt()
  @Min(5000)
  @Transform(toNumber({ defaultValue: 30000 }))
  public VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RESPONSE_TIMEOUT = 30000;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(toNumber({ defaultValue: 2 }))
  public VALIDATOR_REGISTRY_KEYSAPI_SOURCE_MAX_RETRIES = 2;

  /**
   * Use a file with list of validators that are stuck and should be excluded from the monitoring metrics
   */
  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean({ defaultValue: false }))
  public VALIDATOR_USE_STUCK_KEYS_FILE = false;

  /**
   * Path to file with list of validators that are stuck and should be excluded from the monitoring metrics
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value || './docker/validators/stuck_keys.yaml')
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
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Transform(toNumber({ defaultValue: 0 }))
  public SYNC_PARTICIPATION_DISTANCE_DOWN_FROM_CHAIN_AVG = 0;

  /**
   * Number epochs after which we think that our sync participation is bad and alert about that
   * For example:
   *  Our validator have bad participation in 3 epoch in a row
   *  SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG = 3
   *  Then we alert about that
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(10)
  @Transform(toNumber({ defaultValue: 3 }))
  public SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG = 3;

  /**
   * Number epochs after which we think that our attestation is bad and alert about that
   * For example:
   *  Our validator have bad attestation in 3 epoch in a row
   *  BAD_ATTESTATION_EPOCHS = 3
   *  Then we alert about that
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(10)
  @Transform(toNumber({ defaultValue: 3 }))
  public BAD_ATTESTATION_EPOCHS = 3;

  /**
   * Critical alerts will be sent for NOs with validators count greater this value
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Transform(toNumber({ defaultValue: 100 }))
  public CRITICAL_ALERTS_MIN_VAL_COUNT = 100;

  @IsOptional()
  @IsString()
  public CRITICAL_ALERTS_ALERTMANAGER_URL = '';

  /**
   * Additional labels for critical alerts. Must be in JSON string format.
   * For example - '{"a":"valueA","b":"valueB"}'
   */
  @IsOptional()
  @IsObject()
  @Transform(({ value }) => toObject(value))
  public CRITICAL_ALERTS_ALERTMANAGER_LABELS = {};

  @IsOptional()
  @IsEnum(WorkingMode)
  @Transform(({ value }) => value || WorkingMode.Finalized)
  public WORKING_MODE = WorkingMode.Finalized;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config);

  const validatorOptions = { skipMissingProperties: false };
  const errors = validateSync(validatedConfig, validatorOptions);

  if (errors.length > 0) {
    console.error(errors.toString());
    process.exit(1);
  }

  return validatedConfig;
}

// ====================================================================================================================
// PRIVATE FUNCTIONS
// ====================================================================================================================
function toNumber({ defaultValue }) {
  return function ({ value }) {
    if (value == null || value === '') {
      return defaultValue;
    }
    return Number(value);
  };
}

function toBoolean({ defaultValue }) {
  return function ({ value }) {
    if (value == null || value === '') {
      return defaultValue;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    const str = value.toString().toLowerCase().trim();

    switch (str) {
      case 'true':
      case 'yes':
      case '1':
        return true;

      case 'false':
      case 'no':
      case '0':
        return false;

      default:
        return value;
    }
  };
}

function toArrayOfUrls(url: string | null): string[] {
  if (url == null || url === '') {
    return [];
  }

  return url.split(',').map((str) => str.trim().replace(/\/$/, ''));
}

function toObject(str: string | null): Object | string {
  if (str == null || str === '') {
    return {};
  }

  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
}
