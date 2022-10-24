import got, { HTTPError, Response } from 'got';
import { ResponseError, errCommon, errRequest, MaxDeepError } from './errors';
import { parseChunked } from '@discoveryjs/json-ext';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { PrometheusService } from 'common/prometheus';
import { ConfigService } from 'common/config';
import { bigintRange } from 'common/functions/range';
import { retrier } from 'common/functions/retrier';
import { rejectDelay } from 'common/functions/rejectDelay';
import { urljoin } from 'common/functions/urljoin';
import {
  AttesterDutyInfo,
  BlockHeaderResponse,
  FinalityCheckpointsResponse,
  GenesisResponse,
  ProposerDutyInfo,
  BlockInfoResponse,
  StateValidatorResponse,
  SyncCommitteeDutyInfo,
  SyncCommitteeInfo,
  VersionResponse,
} from './intefaces';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';
import { BlockCache, BlockCacheService } from './block-cache.service';
import { BlockId, Epoch, RootHex, Slot, StateId, ValidatorIndex } from './types';

interface RequestRetryOptions {
  maxRetries?: number;
  dataOnly?: boolean;
  useFallbackOnRejected?: (e: any) => boolean;
  useFallbackOnResolved?: (r: any) => boolean;
}

@Injectable()
export class ConsensusProviderService {
  protected apiUrls: string[];
  protected version = '';
  protected genesisTime = 0n;
  protected defaultMaxSlotDeepCount = 32;
  protected lastFinalizedSlot = { slot: 0n, fetchTime: 0 };

  protected endpoints = {
    version: 'eth/v1/node/version',
    genesis: 'eth/v1/beacon/genesis',
    beaconHeadFinalityCheckpoints: 'eth/v1/beacon/states/head/finality_checkpoints',
    blockInfo: (blockId: BlockId): string => `eth/v2/beacon/blocks/${blockId}`,
    beaconHeaders: (blockId: BlockId): string => `eth/v1/beacon/headers/${blockId}`,
    balances: (stateId: StateId): string => `eth/v1/beacon/states/${stateId}/validators`,
    syncCommittee: (stateId: StateId, epoch: Epoch): string => `eth/v1/beacon/states/${stateId}/sync_committees?epoch=${epoch}`,
    proposerDutes: (epoch: Epoch): string => `eth/v1/validator/duties/proposer/${epoch}`,
    attesterDuties: (epoch: Epoch): string => `eth/v1/validator/duties/attester/${epoch}`,
    syncCommitteeDuties: (epoch: Epoch): string => `eth/v1/validator/duties/sync/${epoch}`,
  };

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly cache: BlockCacheService,
  ) {
    this.apiUrls = config.get('CL_API_URLS') as NonEmptyArray<string>;
  }

  public async getVersion(): Promise<string> {
    if (this.version) {
      return this.version;
    }
    const version = (await this.retryRequest<VersionResponse>((apiURL: string) => this.apiGet(apiURL, this.endpoints.version))).version;
    return (this.version = version);
  }

  public async getGenesisTime(): Promise<bigint> {
    if (this.genesisTime > 0) {
      return this.genesisTime;
    }

    const genesisTime = BigInt(
      (await this.retryRequest<GenesisResponse>((apiURL: string) => this.apiGet(apiURL, this.endpoints.genesis))).genesis_time,
    );
    this.logger.log(`Got genesis time [${genesisTime}] from Consensus Layer Client API`);
    return (this.genesisTime = genesisTime);
  }

  public async getFinalizedEpoch(): Promise<Epoch> {
    return BigInt(
      (
        await this.retryRequest<FinalityCheckpointsResponse>((apiURL: string) =>
          this.apiGet(apiURL, this.endpoints.beaconHeadFinalityCheckpoints),
        )
      ).finalized.epoch,
    );
  }

  public async getBeaconBlockHeader(blockId: BlockId): Promise<BlockHeaderResponse | void> {
    const cached: BlockCache = this.cache.get(String(blockId));
    if (cached && (cached.missed || cached.header)) {
      this.logger.debug(`Get ${blockId} header from blocks cache`);
      return cached.missed ? undefined : cached.header;
    }

    const blockHeader = await this.retryRequest<BlockHeaderResponse>(
      (apiURL: string) => this.apiGet(apiURL, this.endpoints.beaconHeaders(blockId)),
      {
        maxRetries: this.config.get('CL_API_GET_BLOCK_INFO_MAX_RETRIES'),
        useFallbackOnResolved: (r) => {
          if (blockId == 'finalized') {
            if (BigInt(r.data.header.message.slot) > this.lastFinalizedSlot.slot) {
              this.lastFinalizedSlot = { slot: BigInt(r.data.header.message.slot), fetchTime: Number(Date.now()) };
            } else if (Number(Date.now()) - this.lastFinalizedSlot.fetchTime > 420 * 1000) {
              // if 'finalized' slot doesn't change ~7m we must switch to fallback
              this.logger.error("Finalized slot hasn't changed in ~7m");
              return true;
            }
          }
          // for other states don't use fallback on resolved
          return false;
        },
      },
    ).catch((e) => {
      if (404 != e.$httpCode) {
        this.logger.error('Unexpected status code while fetching block header');
        throw e;
      }
    });

    this.cache.set(String(blockId), { missed: !blockHeader, header: blockHeader });

    return blockHeader;
  }

  /**
   * Get block header or previous head if missed.
   * Since missed block has no header, we must get block header from the next block by its parent_root
   * @param slot
   */
  public async getBeaconBlockHeaderOrPreviousIfMissed(slot: Slot): Promise<BlockHeaderResponse> {
    const header = await this.getBeaconBlockHeader(slot);
    if (header) return header;
    // if block is missed, try to get next not missed block header
    const nextNotMissedHeader = await this.getNextNotMissedBlockHeader(slot + 1n);

    this.logger.log(
      `Found next not missed slot [${nextNotMissedHeader.header.message.slot}] root [${nextNotMissedHeader.root}] after slot [${slot}]`,
    );

    // and get the closest block header by parent root from next
    const previousBlockHeader = <BlockHeaderResponse>await this.getBeaconBlockHeader(nextNotMissedHeader.header.message.parent_root);
    this.logger.log(`Block [${slot}] is missed. Returning previous not missed block header [${previousBlockHeader.header.message.slot}]`);

    return previousBlockHeader;
  }

  public async getNextNotMissedBlockHeader(slot: Slot, maxDeep = this.defaultMaxSlotDeepCount): Promise<BlockHeaderResponse> {
    const header = await this.getBeaconBlockHeader(slot);
    if (!header) {
      if (maxDeep < 1) {
        throw new MaxDeepError(`Error when trying to get next not missed block header. From ${slot} to ${slot + BigInt(maxDeep)}`);
      }
      this.logger.log(`Try to get next header from ${slot + 1n} slot because ${slot} is missing`);
      return await this.getNextNotMissedBlockHeader(slot + 1n, maxDeep - 1);
    }
    return header;
  }

  public async getPreviousNotMissedBlockHeader(slot: Slot, maxDeep = this.defaultMaxSlotDeepCount): Promise<BlockHeaderResponse> {
    const header = await this.getBeaconBlockHeader(slot);
    if (!header) {
      if (maxDeep < 1) {
        throw new MaxDeepError(`Error when trying to get previous not missed block header. From ${slot} to ${slot - BigInt(maxDeep)}`);
      }
      this.logger.log(`Try to get previous info from ${slot - 1n} slot because ${slot} is missing`);
      return await this.getPreviousNotMissedBlockHeader(slot - 1n, maxDeep - 1);
    }
    return header;
  }

  /**
   * Trying to get attester or proposer duty dependent block root
   */
  public async getDutyDependentRoot(epoch: Epoch): Promise<string> {
    this.logger.log(`Getting duty dependent root for epoch ${epoch}`);
    const dutyRootSlot = epoch * BigInt(this.config.get('FETCH_INTERVAL_SLOTS')) - 1n;
    return (await this.getPreviousNotMissedBlockHeader(dutyRootSlot)).root;
  }

  /**
   * Trying to get nearest block with slot attestation info.
   * Assumed that the ideal attestation is included in the next non-missed block
   */
  public async getBlockInfoWithSlotAttestations(
    slot: Slot,
    maxDeep = this.defaultMaxSlotDeepCount,
  ): Promise<[BlockInfoResponse | void, Array<string>]> {
    const nearestBlockIncludedAttestations = slot + 1n; // good attestation should be included to the next block
    let blockInfo;
    let missedSlots: bigint[] = [];
    try {
      blockInfo = await this.getNextNotMissedBlockInfo(nearestBlockIncludedAttestations, maxDeep);
    } catch (e) {
      if (e instanceof MaxDeepError) {
        this.logger.error(
          `Error when trying to get nearest block with attestations for slot ${slot}: from ${slot} to ${slot + BigInt(maxDeep)}`,
        );
        missedSlots = bigintRange(nearestBlockIncludedAttestations, nearestBlockIncludedAttestations + BigInt(maxDeep + 1));
      } else {
        throw e;
      }
    }

    if (blockInfo && nearestBlockIncludedAttestations != BigInt(blockInfo.message.slot)) {
      missedSlots = bigintRange(nearestBlockIncludedAttestations, BigInt(blockInfo.message.slot));
    }
    return [blockInfo, missedSlots.map((v) => v.toString())];
  }

  public async getNextNotMissedBlockInfo(slot: Slot, maxDeep = this.defaultMaxSlotDeepCount): Promise<BlockInfoResponse | undefined> {
    const blockInfo = await this.getBlockInfo(slot);
    if (!blockInfo) {
      if (maxDeep < 1) {
        throw new MaxDeepError(`Error when trying to get next not missed block info. From ${slot} to ${slot + BigInt(maxDeep)}`);
      }
      this.logger.log(`Try to get next info from ${slot + 1n} slot because ${slot} is missing`);
      return await this.getNextNotMissedBlockInfo(slot + 1n, maxDeep - 1);
    }
    return blockInfo;
  }

  public async getBalances(stateId: StateId): Promise<StateValidatorResponse[]> {
    return await this.retryRequest((apiURL: string) => this.apiLargeGet(apiURL, this.endpoints.balances(stateId)));
  }

  public async getBlockInfo(blockId: BlockId): Promise<BlockInfoResponse | void> {
    const cached: BlockCache = this.cache.get(String(blockId));
    if (cached && (cached.missed || cached.info)) {
      this.logger.debug(`Get ${blockId} info from blocks cache`);
      return cached.missed ? undefined : cached.info;
    }

    const blockInfo = await this.retryRequest<BlockInfoResponse>(
      (apiURL: string) => this.apiGet(apiURL, this.endpoints.blockInfo(blockId)),
      {
        maxRetries: this.config.get('CL_API_GET_BLOCK_INFO_MAX_RETRIES'),
      },
    ).catch((e) => {
      if (404 != e.$httpCode) {
        this.logger.error('Unexpected status code while fetching block info');
        throw e;
      }
    });

    this.cache.set(String(blockId), { missed: !blockInfo, info: blockInfo });

    return blockInfo;
  }

  public async getSyncCommitteeInfo(stateId: StateId, epoch: Epoch): Promise<SyncCommitteeInfo> {
    return await this.retryRequest((apiURL: string) => this.apiGet(apiURL, this.endpoints.syncCommittee(stateId, epoch)));
  }

  public async getCanonicalAttesterDuties(
    epoch: Epoch,
    dependentRoot: RootHex,
    indexes: ValidatorIndex[],
    maxRetriesForGetCanonical = 3,
  ): Promise<AttesterDutyInfo[]> {
    const retry = retrier(this.logger, maxRetriesForGetCanonical, 100, 10000, true);
    const request = async () => {
      const res = <{ dependent_root: string; data: AttesterDutyInfo[] }>(
        await this.retryRequest(
          (apiURL: string) => this.apiLargePost(apiURL, this.endpoints.attesterDuties(epoch), { body: JSON.stringify(indexes) }),
          { dataOnly: false },
        )
      );
      if (res.dependent_root != dependentRoot) {
        throw Error(`Attester duty dependent root is not as expected. Actual: ${res.dependent_root} Expected: ${dependentRoot}`);
      }
      return res.data;
    };

    return await request()
      .catch(() => retry(() => request()))
      .catch(() => {
        throw Error(`Failed to get canonical attester duty info after ${maxRetriesForGetCanonical} retries`);
      });
  }

  public async getChunkedAttesterDuties(epoch: Epoch, dependentRoot: RootHex, indexes: string[]): Promise<AttesterDutyInfo[]> {
    let result: AttesterDutyInfo[] = [];
    const chunked = [...indexes];
    while (chunked.length > 0) {
      const chunk = chunked.splice(0, this.config.get('CL_API_POST_REQUEST_CHUNK_SIZE')); // large payload may cause endpoint exception
      result = result.concat(await this.getCanonicalAttesterDuties(epoch, dependentRoot, chunk));
    }
    return result;
  }

  public async getSyncCommitteeDuties(epoch: Epoch, indexes: string[]): Promise<SyncCommitteeDutyInfo[]> {
    let result: SyncCommitteeDutyInfo[] = [];
    const chunked = [...indexes];
    while (chunked.length > 0) {
      const chunk = chunked.splice(0, this.config.get('CL_API_POST_REQUEST_CHUNK_SIZE')); // large payload may cause endpoint exception
      result = result.concat(
        <SyncCommitteeDutyInfo[]>await this.retryRequest((apiURL: string) =>
          this.apiLargePost(apiURL, this.endpoints.syncCommitteeDuties(epoch), { body: JSON.stringify(chunk) }),
        ).catch((e) => {
          this.logger.error('Unexpected status code while fetching sync committee duties info');
          throw e;
        }),
      );
    }
    return result;
  }

  public async getCanonicalProposerDuties(
    epoch: Epoch,
    dependentRoot: RootHex,
    maxRetriesForGetCanonical = 3,
  ): Promise<ProposerDutyInfo[]> {
    const retry = retrier(this.logger, maxRetriesForGetCanonical, 100, 10000, true);
    const request = async () => {
      const res = <{ dependent_root: string; data: ProposerDutyInfo[] }>await this.retryRequest(
        (apiURL: string) => this.apiGet(apiURL, this.endpoints.proposerDutes(epoch)),
        { dataOnly: false },
      ).catch((e) => {
        this.logger.error('Unexpected status code while fetching proposer duties info');
        throw e;
      });
      if (res.dependent_root != dependentRoot) {
        throw Error(`Proposer duty dependent root is not as expected. Actual: ${res.dependent_root} Expected: ${dependentRoot}`);
      }
      return res.data;
    };

    return await request()
      .catch(() => retry(() => request()))
      .catch(() => {
        throw Error(`Failed to get canonical proposer duty info after ${maxRetriesForGetCanonical} retries`);
      });
  }

  public async getSlotTime(slot: Slot): Promise<bigint> {
    return (await this.getGenesisTime()) + slot * BigInt(this.config.get('CHAIN_SLOT_TIME_SECONDS'));
  }

  protected async retryRequest<T>(callback: (apiURL: string) => any, options?: RequestRetryOptions): Promise<T> {
    options = {
      maxRetries: options?.maxRetries ?? this.config.get('CL_API_MAX_RETRIES'),
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
        .catch(rejectDelay(this.config.get('CL_API_RETRY_DELAY_MS')))
        .catch(() => retry(() => callback(this.apiUrls[i])))
        .then((r: any) => {
          if (options.useFallbackOnResolved(r)) {
            err = Error('Unresolved data on a successful CL API response');
            return undefined;
          }
          return r;
        })
        .catch((e: any) => {
          if (options.useFallbackOnRejected(e)) {
            err = e;
            return undefined;
          }
          throw e;
        });
      if (i == this.apiUrls.length - 1 && !res) {
        err.message = `Error while doing CL API request on all passed URLs. ${err.message}`;
        throw err;
      }
      if (!res) {
        this.logger.warn(`${err.message}. Error while doing CL API request. Will try to switch to another API URL`);
      }
    }

    if (options.dataOnly) return res.data;
    else return res;
  }

  protected apiGet = async <T>(apiURL: string, subUrl: string): Promise<T> => {
    return await this.prometheus.trackCLRequest(apiURL, subUrl, async () => {
      const res = await got
        .get(urljoin(apiURL, subUrl), { timeout: { response: this.config.get('CL_API_GET_RESPONSE_TIMEOUT') } })
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
    });
  };

  protected apiPost = async <T>(apiURL: string, subUrl: string, params?: Record<string, any>): Promise<T> => {
    return await this.prometheus.trackCLRequest(apiURL, subUrl, async () => {
      const res = await got
        .post(urljoin(apiURL, subUrl), { timeout: { response: this.config.get('CL_API_POST_RESPONSE_TIMEOUT') }, ...params })
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
    });
  };

  protected apiLargeGet = async (apiURL: string, subUrl: string): Promise<any> => {
    return await this.prometheus.trackCLRequest(apiURL, subUrl, async () => {
      return await parseChunked(
        got.stream
          .get(urljoin(apiURL, subUrl), { timeout: { response: this.config.get('CL_API_GET_RESPONSE_TIMEOUT') } })
          .on('response', (r: Response) => {
            if (r.statusCode != 200) throw new HTTPError(r);
          }),
      ).catch((e) => {
        if (e instanceof HTTPError) {
          throw new ResponseError(errRequest(<string>e.response.body, subUrl, apiURL), e.response.statusCode);
        }
        throw new ResponseError(errCommon(e.message, subUrl, apiURL));
      });
    });
  };

  protected apiLargePost = async (apiURL: string, subUrl: string, params?: Record<string, any>): Promise<any> => {
    return await this.prometheus.trackCLRequest(apiURL, subUrl, async () => {
      return await parseChunked(
        got.stream
          .post(urljoin(apiURL, subUrl), { timeout: { response: this.config.get('CL_API_POST_RESPONSE_TIMEOUT') }, ...params })
          .on('response', (r: Response) => {
            if (r.statusCode != 200) throw new HTTPError(r);
          }),
      ).catch((e) => {
        if (e instanceof HTTPError) {
          throw new ResponseError(errRequest(<string>e.response.body, subUrl, apiURL), e.response.statusCode);
        }
        throw new ResponseError(errCommon(e.message, subUrl, apiURL));
      });
    });
  };
}
