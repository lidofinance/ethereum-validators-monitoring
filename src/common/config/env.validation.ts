import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPort,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';
import { Environment, LogFormat, LogLevel } from './interfaces';
import { Network } from '../../ethereum/execution/execution.constants';

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
  @Min(1)
  @Max(65535)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public HTTP_PORT = 8080;

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.info;

  @IsEnum(LogFormat)
  LOG_FORMAT: LogFormat = LogFormat.simple;

  @IsBoolean()
  @Transform(({ value }) => toBoolean(value), { toClassOnly: true })
  public DRY_RUN = false;

  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  public DB_HOST!: string;

  @IsString()
  @MinLength(3)
  public DB_USER!: string;

  @IsString()
  @MinLength(0)
  public DB_PASSWORD!: string;

  @IsNotEmpty()
  @MinLength(1)
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

  @IsNumber()
  @Min(100)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public DB_INSERT_CHUNK_SIZE = 1500;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5000000)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ETH_NETWORK!: Network;

  @IsNotEmpty()
  @IsUrl()
  public ETH1_RPC_URL!: string;

  @ValidateIf((env) => env.ETH1_RPC_URL_BACKUP.length)
  @IsUrl()
  public ETH1_RPC_URL_BACKUP = '';

  @IsInt()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ETH1_RPC_RETRY_DELAY_MS = 500;

  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  public ETH2_BEACON_RPC_URL!: string;

  @ValidateIf((env) => env.ETH2_BEACON_RPC_URL_BACKUP.length)
  @IsUrl()
  public ETH2_BEACON_RPC_URL_BACKUP = '';

  @IsInt()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ETH2_BEACON_RPC_RETRY_DELAY_MS = 500;

  @IsNumber()
  @Min(5000)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ETH2_GET_RESPONSE_TIMEOUT = 15000;

  @IsNumber()
  @Min(10000)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ETH2_POST_RESPONSE_TIMEOUT = 15000;

  @IsNumber()
  @Min(10000)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ETH2_POST_REQUEST_CHUNK_SIZE = 30000;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ETH2_GET_BLOCK_INFO_MAX_RETRIES = 5;

  @IsNumber()
  @Min(18950)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public START_SLOT = 1518000;

  @IsNumber()
  @Min(32)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public FETCH_INTERVAL_SLOTS = 32;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CHAIN_SLOT_TIME_SECONDS = 12;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public REGISTRY_CONCURRENCY_LIMIT = 200;

  /**
   * Distance (down) from Blockchain Sync Participation average after which we think that our sync participation is bad
   * For example:
   *  Blockchain Sync participation = 99%
   *  Lido validator 1 = 78%
   *  Lido validator 2 = 98%
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
   * Maximum inclusion delay after which we think that attestation is bad
   */
  @IsNumber()
  @Min(1)
  @Max(8)
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public ATTESTATION_MAX_INCLUSION_IN_BLOCK_DELAY = 5;

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
  @Transform(({ value }) => parseInt(value, 10), { toClassOnly: true })
  public CRITICAL_ALERTS_MIN_VAL_COUNT = 100;

  @ValidateIf((env) => env.CRITICAL_ALERTS_ALERTMANAGER_URL.length)
  @IsUrl()
  public CRITICAL_ALERTS_ALERTMANAGER_URL = '';
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
