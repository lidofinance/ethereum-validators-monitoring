import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { HTTPError, Response, got } from 'got-cjs';

import { ConfigService } from 'common/config';
import { ResponseError, errCommon, errRequest } from 'common/consensus-provider';
import { rejectDelay } from 'common/functions/rejectDelay';
import { retrier } from 'common/functions/retrier';
import { urljoin } from 'common/functions/urljoin';
import { PrometheusService, TrackKeysAPIRequest } from 'common/prometheus';

interface RequestRetryOptions {
  maxRetries?: number;
  dataOnly?: boolean;
  useFallbackOnRejected?: (last_error: any, current_error: any) => boolean;
  useFallbackOnResolved?: (r: any) => boolean;
}

interface StatusResponse {
  appVersion: string;
  chainId: number;
  elBlockSnapshot: any;
}

interface ModulesResponse {
  nonce: number;
  type: string;
  id: 1;
  stakingModuleAddress: string;
  name: string;
}

const REQUEST_TIMEOUT_POLICY_MS = {
  // Starts when a socket is assigned.
  // Ends when the hostname has been resolved.
  lookup: undefined,
  // Starts when lookup completes.
  // Ends when the socket is fully connected.
  // If lookup does not apply to the request, this event starts when the socket is assigned and ends when the socket is connected.
  connect: 1000,
  // Starts when connect completes.
  // Ends when the handshake process completes.
  secureConnect: undefined,
  // Starts when the socket is connected.
  // Resets when new data is transferred.
  socket: undefined,
  // Starts when the socket is connected.
  // Ends when all data have been written to the socket.
  send: undefined,
  // Starts when request has been flushed.
  // Ends when the headers are received.
  // Will be redefined by `CL_API_GET_RESPONSE_TIMEOUT`
  response: 1000,
};

@Injectable()
export class KeysapiSourceClient {
  protected apiUrls: string[];

  protected endpoints = {
    usedKeys: 'v1/keys?used=true',
    operators: 'v1/operators',
    modules: 'v1/modules',
    status: 'v1/status',
  };

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
  ) {
    this.apiUrls = this.config.get('VALIDATOR_REGISTRY_KEYSAPI_SOURCE_URLS');
  }

  public async getStatus(): Promise<StatusResponse> {
    return await this.retryRequest<StatusResponse>(async (apiURL: string) => this.apiGet(apiURL, this.endpoints.status), {
      dataOnly: false,
    });
  }

  public async getModules(): Promise<ModulesResponse[]> {
    return await this.retryRequest<ModulesResponse[]>(async (apiURL: string) => this.apiGet(apiURL, this.endpoints.modules));
  }

  public async getOperators(): Promise<Request> {
    return await this.retryRequest(async (apiURL: string) => await this.apiGetStream(apiURL, this.endpoints.operators), {
      dataOnly: false,
    });
  }

  public async getUsedKeys(): Promise<Request> {
    return await this.retryRequest(async (apiURL: string) => await this.apiGetStream(apiURL, this.endpoints.usedKeys), {
      dataOnly: false,
    });
  }

  protected async retryRequest<T>(callback: (apiURL: string) => Promise<any>, options?: RequestRetryOptions): Promise<T> {
    options = {
      maxRetries: options?.maxRetries ?? this.config.get('VALIDATOR_REGISTRY_KEYSAPI_SOURCE_MAX_RETRIES'),
      dataOnly: options?.dataOnly ?? true,
      useFallbackOnRejected: options?.useFallbackOnRejected ?? (() => true), //  use fallback on error as default
      useFallbackOnResolved: options?.useFallbackOnResolved ?? (() => false), // do NOT use fallback on success as default
    };
    const retry = retrier(this.logger, options.maxRetries, 100, 10000, true);
    let res;
    let err;
    for (let i = 0; i < this.apiUrls.length; i++) {
      if (res) break;
      res = await callback(this.apiUrls[i])
        .catch(rejectDelay(this.config.get('VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RETRY_DELAY_MS')))
        .catch(() => retry(() => callback(this.apiUrls[i])))
        .then((r: any) => {
          if (options.useFallbackOnResolved(r)) {
            err = Error('Unresolved data on a successful KeysAPI response');
            return undefined;
          }
          return r;
        })
        .catch((current_error: any) => {
          if (options.useFallbackOnRejected(err, current_error)) {
            err = current_error;
            return undefined;
          }
          throw current_error;
        });
      if (i == this.apiUrls.length - 1 && !res) {
        err.message = `Error while doing KeysAPI request on all passed URLs. ${err.message}`;
        throw err;
      }
      if (!res) {
        this.logger.warn(`${err.message}. Error while doing KeysAPI request. Will try to switch to another API URL`);
      }
    }

    if (options.dataOnly) return res.data;
    else return res;
  }

  @TrackKeysAPIRequest
  protected async apiGet<T>(apiURL: string, subUrl: string): Promise<T> {
    const res = await got
      .get(urljoin(apiURL, subUrl), {
        timeout: { ...REQUEST_TIMEOUT_POLICY_MS, response: this.config.get('VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RESPONSE_TIMEOUT') },
      })
      .catch((e) => {
        if (e.response) {
          throw new ResponseError(errRequest(e.response.body, subUrl, apiURL), e.response.statusCode);
        }
        throw new ResponseError(errCommon(e.message, subUrl, apiURL));
      });
    if (res.statusCode !== 200) {
      throw new ResponseError(errRequest(res.body, subUrl, apiURL), res.statusCode);
    }
    try {
      return JSON.parse(res.body);
    } catch (e) {
      throw new ResponseError(`Error converting response body to JSON. Body: ${res.body}`);
    }
  }

  @TrackKeysAPIRequest
  protected async apiGetStream(apiURL: string, subUrl: string): Promise<Request> {
    const readStream = got.stream.get(urljoin(apiURL, subUrl), {
      timeout: { ...REQUEST_TIMEOUT_POLICY_MS, response: this.config.get('VALIDATOR_REGISTRY_KEYSAPI_SOURCE_RESPONSE_TIMEOUT') },
    });

    return new Promise((resolve, reject) => {
      readStream.on('response', (r: Response) => {
        if (r.statusCode != 200) reject(new HTTPError(r));
        resolve(readStream);
      });
      readStream.on('error', (e) => reject(e));
    })
      .then((r: Request) => r)
      .catch((e) => {
        if (e instanceof HTTPError) {
          throw new ResponseError(errRequest(<string>e.response.body, subUrl, apiURL), e.response.statusCode);
        }
        throw new ResponseError(errCommon(e.message, subUrl, apiURL));
      });
  }
}
