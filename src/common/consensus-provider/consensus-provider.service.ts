import { ContainerTreeViewType } from '@chainsafe/ssz/lib/view/container';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';
import { request } from 'undici';
import { IncomingHttpHeaders } from 'undici/types/header';
import BodyReadable from 'undici/types/readable';

import { ConfigService } from 'common/config';
import { range } from 'common/functions/range';
import { rejectDelay } from 'common/functions/rejectDelay';
import { retrier } from 'common/functions/retrier';
import { urljoin } from 'common/functions/urljoin';
import { PrometheusService, TrackCLRequest } from 'common/prometheus';
import { EpochProcessingState } from 'storage/clickhouse';

import { BlockCache, BlockCacheService } from './block-cache';
import { MaxDeepError, ResponseError, errCommon, errRequest } from './errors';
import {
  BlockHeaderResponse,
  BlockInfoResponse,
  FinalityCheckpointsResponse,
  GenesisResponse,
  ProposerDutyInfo,
  SyncCommitteeInfo,
  VersionResponse,
} from './intefaces';
import { BlockId, Epoch, Slot, StateId } from './types';

let ssz: typeof import('@lodestar/types').ssz;
let anySsz: typeof ssz.phase0 | typeof ssz.altair | typeof ssz.bellatrix | typeof ssz.capella | typeof ssz.deneb;
let ForkName: typeof import('@lodestar/params').ForkName;

interface RequestRetryOptions {
  maxRetries?: number;
  dataOnly?: boolean;
  useFallbackOnRejected?: (last_error: any, current_error: any) => boolean;
  useFallbackOnResolved?: (r: any) => boolean;
}

@Injectable()
export class ConsensusProviderService {
  protected apiUrls: string[];
  protected version = '';
  protected genesisTime = 0;
  protected defaultMaxSlotDeepCount = 32;
  protected latestSlot = { slot: 0, fetchTime: 0 };

  protected endpoints = {
    version: 'eth/v1/node/version',
    genesis: 'eth/v1/beacon/genesis',
    beaconHeadFinalityCheckpoints: 'eth/v1/beacon/states/head/finality_checkpoints',
    blockInfo: (blockId: BlockId): string => `eth/v2/beacon/blocks/${blockId}`,
    beaconHeaders: (blockId: BlockId): string => `eth/v1/beacon/headers/${blockId}`,
    attestationCommittees: (stateId: StateId, epoch: Epoch): string => `eth/v1/beacon/states/${stateId}/committees?epoch=${epoch}`,
    syncCommittee: (stateId: StateId, epoch: Epoch): string => `eth/v1/beacon/states/${stateId}/sync_committees?epoch=${epoch}`,
    proposerDutes: (epoch: Epoch): string => `eth/v1/validator/duties/proposer/${epoch}`,
    state: (stateId: StateId): string => `eth/v2/debug/beacon/states/${stateId}`,
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
    const version = (await this.retryRequest<VersionResponse>(async (apiURL: string) => this.apiGet(apiURL, this.endpoints.version)))
      .version;
    return (this.version = version);
  }

  public async getGenesisTime(): Promise<number> {
    if (this.genesisTime > 0) {
      return this.genesisTime;
    }

    const genesisTime = Number(
      (await this.retryRequest<GenesisResponse>(async (apiURL: string) => this.apiGet(apiURL, this.endpoints.genesis))).genesis_time,
    );
    this.logger.log(`Got genesis time [${genesisTime}] from Consensus Layer Client API`);
    return (this.genesisTime = genesisTime);
  }

  public async getFinalizedEpoch(): Promise<Epoch> {
    return Number(
      (
        await this.retryRequest<FinalityCheckpointsResponse>(async (apiURL: string) =>
          this.apiGet(apiURL, this.endpoints.beaconHeadFinalityCheckpoints),
        )
      ).finalized.epoch,
    );
  }

  public async getLatestBlockHeader(processingState: EpochProcessingState): Promise<BlockHeaderResponse | void> {
    const latestFrom = this.config.get('WORKING_MODE');
    return await this.retryRequest<BlockHeaderResponse>(
      async (apiURL: string) => this.apiGet(apiURL, this.endpoints.beaconHeaders(latestFrom)),
      {
        maxRetries: this.config.get('CL_API_GET_BLOCK_INFO_MAX_RETRIES'),
        useFallbackOnResolved: (r) => {
          const nodeLatestSlot = Number(r.data.header.message.slot);

          if (nodeLatestSlot < this.latestSlot.slot) {
            // we assume that the node must never return a slot less than the last saved slot
            this.logger.error(
              `Received ${latestFrom} slot [${nodeLatestSlot}] is less than last [${this.latestSlot.slot}] slot received before, but shouldn't`,
            );
            return true;
          }
          if (nodeLatestSlot > this.latestSlot.slot) {
            this.latestSlot = { slot: nodeLatestSlot, fetchTime: Number(Date.now()) };
          }
          if (processingState.epoch < Math.trunc(this.latestSlot.slot / this.config.get('FETCH_INTERVAL_SLOTS'))) {
            // if our last processed epoch is less than last, we shouldn't use fallback
            return false;
          } else if (Number(Date.now()) - this.latestSlot.fetchTime > 420 * 1000) {
            // if latest slot doesn't change ~7m we must switch to fallback
            this.logger.error(`Latest slot [${this.latestSlot.slot}] hasn't changed in ~7m`);
            return true;
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
  }

  public async getBlockHeader(blockId: BlockId, ignoreCache = false): Promise<BlockHeaderResponse | void> {
    const cached: BlockCache = this.cache.get(String(blockId));
    if (!ignoreCache && cached && (cached.missed || cached.header)) {
      this.logger.debug(`Get ${blockId} header from blocks cache`);
      return cached.missed ? undefined : cached.header;
    }

    const blockHeader = await this.retryRequest<BlockHeaderResponse>(
      async (apiURL: string) => this.apiGet(apiURL, this.endpoints.beaconHeaders(blockId)),
      {
        maxRetries: this.config.get('CL_API_GET_BLOCK_INFO_MAX_RETRIES'),
        useFallbackOnRejected: (last_fallback_err, curr_fallback_error) => {
          if (last_fallback_err && last_fallback_err.$httpCode == 404 && curr_fallback_error.$httpCode != 404) {
            this.logger.debug('Request error from last fallback was 404, but current is not. Will be used previous error');
            throw last_fallback_err;
          }
          return true;
        },
      },
    ).catch((e) => {
      if (404 != e.$httpCode) {
        this.logger.error('Unexpected status code while fetching block header');
        throw e;
      }
    });

    if (!ignoreCache) {
      this.cache.set(String(blockId), { missed: !blockHeader, header: blockHeader });
    }

    return blockHeader;
  }

  /**
   * Get block header or previous head if missed.
   * Since missed block has no header, we must get block header from the next block by its parent_root
   * @param slot
   */
  public async getBeaconBlockHeaderOrPreviousIfMissed(slot: Slot): Promise<BlockHeaderResponse> {
    const header = await this.getBlockHeader(slot);
    if (header) return header;
    // if block is missed, try to get next not missed block header
    const nextNotMissedHeader = await this.getNextNotMissedBlockHeader(slot + 1);

    this.logger.log(
      `Found next not missed slot [${nextNotMissedHeader.header.message.slot}] root [${nextNotMissedHeader.root}] after slot [${slot}]`,
    );

    // and get the closest block header by parent root from next
    const previousBlockHeader = <BlockHeaderResponse>await this.getBlockHeader(nextNotMissedHeader.header.message.parent_root);
    this.logger.log(`Block [${slot}] is missed. Returning previous not missed block header [${previousBlockHeader.header.message.slot}]`);

    return previousBlockHeader;
  }

  public async getNextNotMissedBlockHeader(slot: Slot, maxDeep = this.defaultMaxSlotDeepCount): Promise<BlockHeaderResponse> {
    const header = await this.getBlockHeader(slot);
    if (!header) {
      if (maxDeep < 1) {
        throw new MaxDeepError(`Error when trying to get next not missed block header. From ${slot} to ${slot + maxDeep}`);
      }
      this.logger.log(`Try to get next header from ${slot + 1} slot because ${slot} is missing`);
      return await this.getNextNotMissedBlockHeader(slot + 1, maxDeep - 1);
    }
    return header;
  }

  public async getPreviousNotMissedBlockHeader(
    slot: Slot,
    maxDeep = this.defaultMaxSlotDeepCount,
    ignoreCache = false,
  ): Promise<BlockHeaderResponse> {
    const header = await this.getBlockHeader(slot, ignoreCache);
    if (!header) {
      if (maxDeep < 1) {
        throw new MaxDeepError(`Error when trying to get previous not missed block header. From ${slot} to ${slot - maxDeep}`);
      }
      this.logger.log(`Try to get previous info from ${slot - 1} slot because ${slot} is missing`);
      return await this.getPreviousNotMissedBlockHeader(slot - 1, maxDeep - 1);
    }
    return header;
  }

  /**
   * Trying to get attester or proposer duty dependent block root
   */
  public async getDutyDependentRoot(epoch: Epoch, ignoreCache = false): Promise<string> {
    this.logger.log(`Getting duty dependent root for epoch ${epoch}`);
    const dutyRootSlot = epoch * this.config.get('FETCH_INTERVAL_SLOTS') - 1;
    return (await this.getPreviousNotMissedBlockHeader(dutyRootSlot, this.defaultMaxSlotDeepCount, ignoreCache)).root;
  }

  /**
   * Trying to get nearest block with slot attestation info.
   * Assumed that the ideal attestation is included in the next non-missed block
   */
  public async getBlockInfoWithSlotAttestations(
    slot: Slot,
    maxDeep = this.defaultMaxSlotDeepCount,
  ): Promise<[BlockInfoResponse | undefined, Array<number>]> {
    const nearestBlockIncludedAttestations = slot + 1; // good attestation should be included to the next block
    let blockInfo;
    let missedSlots: number[] = [];
    try {
      blockInfo = await this.getNextNotMissedBlockInfo(nearestBlockIncludedAttestations, maxDeep);
    } catch (e) {
      if (e instanceof MaxDeepError) {
        this.logger.error(`Error when trying to get nearest block with attestations for slot ${slot}: from ${slot} to ${slot + maxDeep}`);
        missedSlots = range(nearestBlockIncludedAttestations, nearestBlockIncludedAttestations + maxDeep + 1);
      } else {
        throw e;
      }
    }

    if (blockInfo && nearestBlockIncludedAttestations != Number(blockInfo.message.slot)) {
      missedSlots = range(nearestBlockIncludedAttestations, Number(blockInfo.message.slot));
    }
    return [blockInfo, missedSlots];
  }

  public async getNextNotMissedBlockInfo(slot: Slot, maxDeep = this.defaultMaxSlotDeepCount): Promise<BlockInfoResponse | undefined> {
    const blockInfo = await this.getBlockInfo(slot);
    if (!blockInfo) {
      if (maxDeep < 1) {
        throw new MaxDeepError(`Error when trying to get next not missed block info. From ${slot} to ${slot + maxDeep}`);
      }
      this.logger.log(`Try to get next info from ${slot + 1} slot because ${slot} is missing`);
      return await this.getNextNotMissedBlockInfo(slot + 1, maxDeep - 1);
    }
    return blockInfo;
  }

  public async getState(stateId: StateId): Promise<ContainerTreeViewType<typeof anySsz.BeaconState.fields>> {
    const { body, headers } = await this.retryRequest<{ body: BodyReadable; headers: IncomingHttpHeaders }>(
      async (apiURL: string) => await this.apiGetStream(apiURL, this.endpoints.state(stateId), { accept: 'application/octet-stream' }),
      {
        dataOnly: false,
      },
    );
    const forkName = headers['eth-consensus-version'] as keyof typeof ForkName;
    const bodyBytes = new Uint8Array(await body.arrayBuffer());
    // ugly hack to import ESModule to CommonJS project
    ssz = await eval(`import('@lodestar/types').then((m) => m.ssz)`);
    return ssz[forkName].BeaconState.deserializeToView(bodyBytes) as any as ContainerTreeViewType<typeof anySsz.BeaconState.fields>;
  }

  public async getBlockInfo(blockId: BlockId): Promise<BlockInfoResponse | void> {
    const cached: BlockCache = this.cache.get(String(blockId));
    if (cached && (cached.missed || cached.info)) {
      this.logger.debug(`Get ${blockId} info from blocks cache`);
      return cached.missed ? undefined : cached.info;
    }

    const blockInfo = await this.retryRequest<BlockInfoResponse>(
      async (apiURL: string) => this.apiGet(apiURL, this.endpoints.blockInfo(blockId)),
      {
        maxRetries: this.config.get('CL_API_GET_BLOCK_INFO_MAX_RETRIES'),
        useFallbackOnRejected: (last_fallback_err, curr_fallback_error) => {
          if (last_fallback_err && last_fallback_err.$httpCode == 404 && curr_fallback_error.$httpCode != 404) {
            this.logger.debug('Request error from last fallback was 404, but current is not. Will be used previous error');
            throw last_fallback_err;
          }
          return true;
        },
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

  public async getAttestationCommitteesInfo(stateId: StateId, epoch: Epoch): Promise<BodyReadable> {
    const { body }: BodyReadable = await this.retryRequest(
      async (apiURL: string) => await this.apiGetStream(apiURL, this.endpoints.attestationCommittees(stateId, epoch)),
      {
        dataOnly: false,
      },
    );
    return body;
  }

  public async getSyncCommitteeInfo(stateId: StateId, epoch: Epoch): Promise<SyncCommitteeInfo> {
    return await this.retryRequest(async (apiURL: string) => this.apiGet(apiURL, this.endpoints.syncCommittee(stateId, epoch)));
  }

  public async getCanonicalProposerDuties(epoch: Epoch, maxRetriesForGetCanonical = 3, ignoreCache = false): Promise<ProposerDutyInfo[]> {
    const retry = retrier(this.logger, maxRetriesForGetCanonical, 100, 10000, true);
    const request = async () => {
      const dependentRoot = await this.getDutyDependentRoot(epoch, ignoreCache);
      this.logger.log(`Proposer Duty root: ${dependentRoot}`);
      const res = <{ dependent_root: string; data: ProposerDutyInfo[] }>await this.retryRequest(
        async (apiURL: string) => this.apiGet(apiURL, this.endpoints.proposerDutes(epoch)),
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

  public async getSlotTime(slot: Slot): Promise<number> {
    return (await this.getGenesisTime()) + slot * this.config.get('CHAIN_SLOT_TIME_SECONDS');
  }

  protected async retryRequest<T>(callback: (apiURL: string) => Promise<any>, options?: RequestRetryOptions): Promise<T> {
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
        .catch((current_error: any) => {
          if (options.useFallbackOnRejected(err, current_error)) {
            err = current_error;
            return undefined;
          }
          throw current_error;
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

  @TrackCLRequest
  protected async apiGet<T>(apiURL: string, subUrl: string): Promise<T> {
    const { body, statusCode } = await request(urljoin(apiURL, subUrl), {
      method: 'GET',
      headersTimeout: this.config.get('CL_API_GET_RESPONSE_TIMEOUT'),
    }).catch((e) => {
      if (e.response) {
        throw new ResponseError(errRequest(e.response.body, subUrl, apiURL), e.response.statusCode);
      }
      throw new ResponseError(errCommon(e.message, subUrl, apiURL));
    });
    if (statusCode !== 200) {
      const errorText = await body.text();
      throw new ResponseError(errRequest(errorText, subUrl, apiURL), statusCode);
    }
    return (await body.json()) as T;
  }

  @TrackCLRequest
  protected async apiGetStream(
    apiURL: string,
    subUrl: string,
    headersToSend?: Record<string, string>,
  ): Promise<{ body: BodyReadable; headers: IncomingHttpHeaders }> {
    const { body, headers, statusCode } = await request(urljoin(apiURL, subUrl), {
      method: 'GET',
      headersTimeout: this.config.get('CL_API_GET_RESPONSE_TIMEOUT'),
      headers: headersToSend,
    }).catch((e) => {
      if (e.response) {
        throw new ResponseError(errRequest(e.response.body, subUrl, apiURL), e.response.statusCode);
      }
      throw new ResponseError(errCommon(e.message, subUrl, apiURL));
    });
    if (statusCode !== 200) {
      const errorText = await body.text();
      throw new ResponseError(errRequest(errorText, subUrl, apiURL), statusCode);
    }
    return { body, headers };
  }
}
