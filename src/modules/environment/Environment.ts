import appRoot                       from 'app-root-path';
import { injectable, postConstruct } from 'inversify';
import {
  plainToClass,
  Transform
}                                    from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPort,
  IsString,
  IsUrl, Max,
  Min,
  MinLength,
  IsOptional,
  validateOrReject, IsBoolean, IsArray
} from 'class-validator';
import { container }                 from '../../container';
import { ILogger }                   from '../logger/ILogger';
import dotenv                        from 'dotenv';
import { resolve }                   from 'path';
import { Network }                   from '../eth-rpc/config';

dotenv.config({path: resolve(appRoot.path, '.env'), debug: true});


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

@injectable()
export class Environment {

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
  @IsOptional()
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public DB_MAX_RETRIES = 10;

  /**
   * Initial backoff time between DB operation retries
   */
  @IsNumber()
  @IsOptional()
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public DB_MIN_BACKOFF_SEC = 1;

  /**
   * Maximum backoff time between DB operation retries
   */
  @IsNumber()
  @IsOptional()
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public DB_MAX_BACKOFF_SEC = 120;

  @IsNumber()
  @Min(100)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public DB_INSERT_CHUNK_SIZE = 1500;

  @IsString()
  public LOG_LEVEL = 'info';

  @IsOptional()
  @IsBoolean()
  @Transform(({value}) => toBoolean(value), {toClassOnly: true})
  public DRY_RUN = false;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5000000)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public ETH_NETWORK!: Network;

  @IsNotEmpty()
  @IsString()
  public ETH1_RPC_URL!: string;

  @IsNotEmpty()
  @IsString()
  public ALERTMANAGER_URL?: string;

  @IsOptional()
  @IsString()
  public ETH1_RPC_URL_BACKUP?: string;

  @IsOptional()
  @IsInt()
  @Transform(({value}) => parseInt(value, 10) || 500, {toClassOnly: true})
  public ETH1_RPC_RETRY_DELAY_MS = 500;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public HTTP_PORT = 8080;

  @IsNotEmpty()
  @IsUrl({require_tld: false})
  public ETH2_BEACON_RPC_URL!: string;

  @IsOptional()
  @IsUrl({require_tld: false})
  public ETH2_BEACON_RPC_URL_BACKUP?: string;

  @IsOptional()
  @IsInt()
  @Transform(({value}) => parseInt(value, 10) || 500, {toClassOnly: true})
  public ETH2_BEACON_RPC_RETRY_DELAY_MS = 500;

  @IsNumber()
  @Min(10000)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public ETH2_GET_RESPONSE_TIMEOUT = 15000;

  @IsNumber()
  @Min(10000)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public ETH2_POST_RESPONSE_TIMEOUT = 15000;

  @IsNumber()
  @Min(10000)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public ETH2_POST_REQUEST_CHUNK_SIZE = 30000;

  @IsNumber()
  @IsOptional()
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public ETH2_GET_BLOCK_INFO_MAX_RETRIES = 5;

  @IsNumber()
  @Min(18950)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public START_SLOT = 1518000;

  @IsNumber()
  @Min(32)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public FETCH_INTERVAL_SLOTS = 32;

  @IsInt()
  @Min(1)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public CHAIN_SLOT_TIME_SECONDS = 12;

  @IsInt()
  @Min(1)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
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
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
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
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public SYNC_PARTICIPATION_EPOCHS_LESS_THAN_CHAIN_AVG = 3;

  /**
   * Maximum inclusion delay after which we think that attestation is bad
   */
  @IsNumber()
  @Min(1)
  @Max(8)
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
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
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public BAD_ATTESTATION_EPOCHS = 3;

  /**
   * Critical alerts will be sent for NOs with validators count greater this value
   */
  @IsNumber()
  @Transform(({value}) => parseInt(value, 10), {toClassOnly: true})
  public CRITICAL_ALERTS_MIN_VAL_COUNT = 100;

  /**
   * List of critical alert names that will be disabled
   */
  @IsArray()
  @Transform(({value}) => value.split(','), {toClassOnly: true})
  public CRITICAL_ALERTS_MUTE_LIST: string[] = [];

  public static create(): Environment {
    return plainToClass(this, process.env);
  }

  @postConstruct()
  public async initialize(): Promise<void> {
    try {
      await validateOrReject(this, {validationError: {target: false, value: false}});
    } catch (validationErrors) {
      const logger = container.get(ILogger);
      (validationErrors as Error[])
        .forEach((error: any) => logger.fatal(`Bad environment variable(s): %o`, error));
      process.exit(1);
    }
  }
}
