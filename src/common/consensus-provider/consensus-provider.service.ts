import { ContainerTreeViewType } from '@chainsafe/ssz/lib/view/container';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { NonEmptyArray } from 'fp-ts/NonEmptyArray';
import { request } from 'undici';
import { IncomingHttpHeaders } from 'undici/types/header';
import BodyReadable from 'undici/types/readable';

import { ConfigService, WorkingMode } from 'common/config';
import { ExecutionProviderService } from 'common/execution-provider';
import { rejectDelay } from 'common/functions/rejectDelay';
import { retrier } from 'common/functions/retrier';
import { urljoin } from 'common/functions/urljoin';
import { PrometheusService, TrackCLRequest } from 'common/prometheus';
import { Epoch, RootHex, Slot, StateId } from 'common/types/types';
import { ClickhouseService } from 'storage';

import { BlockCacheService } from './block-cache';
import { MaxDeepError, ResponseError, errCommon, errRequest } from './errors';
import {
  BlockHeaderResponse,
  BlockInfoResponse,
  GenesisResponse,
  ProposerDutyInfo,
  SpecResponse,
  SyncCommitteeInfo,
  VersionResponse,
} from './intefaces';

type BlockId = RootHex | Slot | 'head' | 'genesis' | 'finalized';

let ssz: typeof import('@lodestar/types').ssz;
let anySsz: typeof ssz.phase0 | typeof ssz.altair | typeof ssz.bellatrix | typeof ssz.capella | typeof ssz.deneb;
let ForkName: typeof import('@lodestar/params').ForkName;

interface RequestRetryOptions {
  maxRetries?: number;
  dataOnly?: boolean;
  useFallbackOnRejected?: (lastError: any, currentError: any) => boolean;
  useFallbackOnResolved?: (r: any) => boolean;
}

export interface ForkEpochs {
  deneb: number;
  electra: number;
}

@Injectable()
export class ConsensusProviderService {
  protected readonly apiUrls: string[];
  protected readonly workingMode: string;
  protected readonly defaultMaxSlotDeepCount: number;
  protected version = '';
  protected genesisTime = 0;
  protected latestSlot = { slot: 0, fetchTime: 0 };
  protected forkEpochs: ForkEpochs;

  protected endpoints = {
    version: 'eth/v1/node/version',
    genesis: 'eth/v1/beacon/genesis',
    spec: 'eth/v1/config/spec',
    blockInfo: (blockId: BlockId): string => `eth/v2/beacon/blocks/${blockId}`,
    beaconHeaders: (blockId: BlockId): string => `eth/v1/beacon/headers/${blockId}`,
    attestationCommittees: (stateId: StateId, epoch: Epoch): string => `eth/v1/beacon/states/${stateId}/committees?epoch=${epoch}`,
    syncCommittee: (stateId: StateId, epoch: Epoch): string => `eth/v1/beacon/states/${stateId}/sync_committees?epoch=${epoch}`,
    proposerDuties: (epoch: Epoch): string => `eth/v1/validator/duties/proposer/${epoch}`,
    state: (stateId: StateId): string => `eth/v2/debug/beacon/states/${stateId}`,
  };

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly cache: BlockCacheService,
    protected readonly storage: ClickhouseService,
    protected readonly executionProvider: ExecutionProviderService,
  ) {
    this.apiUrls = config.get('CL_API_URLS') as NonEmptyArray<string>;
    this.workingMode = config.get('WORKING_MODE');
    this.defaultMaxSlotDeepCount = config.get('CL_API_MAX_SLOT_DEEP_COUNT');
  }

  public async getVersion(): Promise<string> {
    if (this.version) {
      return this.version;
    }
    const version = (await this.retryRequest<VersionResponse>(async (apiURL: string) => this.apiGet(apiURL, this.endpoints.version)))
      .version;
    return (this.version = version);
  }

  public async getForkEpochs(): Promise<ForkEpochs> {
    if (this.forkEpochs != null) {
      return this.forkEpochs;
    }

    const spec = await this.retryRequest<SpecResponse>(async (apiURL: string) => this.apiGet(apiURL, this.endpoints.spec));
    this.forkEpochs = {
      deneb: spec.DENEB_FORK_EPOCH != null ? parseInt(spec.DENEB_FORK_EPOCH, 10) : Number.MAX_SAFE_INTEGER,
      electra: spec.ELECTRA_FORK_EPOCH != null ? parseInt(spec.ELECTRA_FORK_EPOCH, 10) : Number.MAX_SAFE_INTEGER,
    };

    this.logger.log(`Deneb fork epoch: ${this.forkEpochs.deneb}`);
    this.logger.log(`Electra fork epoch: ${this.forkEpochs.electra}`);

    return this.forkEpochs;
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

  public async getLatestSlotHeader(epoch: Epoch): Promise<BlockHeaderResponse> {
    return await this.retryRequest<BlockHeaderResponse>(
      async (apiURL: string) => this.apiGet(apiURL, this.endpoints.beaconHeaders(this.workingMode)),
      {
        maxRetries: this.config.get('CL_API_GET_BLOCK_INFO_MAX_RETRIES'),
        useFallbackOnResolved: (r) => {
          if (this.workingMode === WorkingMode.Finalized && r.finalized != null && !r.finalized) {
            this.logger.error(`getLatestSlotHeader: slot [${r.data.header.message.slot}] is not finalized`);
            return true;
          }

          const nodeLatestSlot = Number(r.data.header.message.slot);

          if (nodeLatestSlot < this.latestSlot.slot) {
            // we assume that the node must never return a slot less than the last saved slot
            this.logger.error(
              `Received ${this.workingMode} slot [${nodeLatestSlot}] is less than last [${this.latestSlot.slot}] slot received before, but shouldn't`,
            );
            return true;
          }
          if (nodeLatestSlot > this.latestSlot.slot) {
            this.latestSlot = { slot: nodeLatestSlot, fetchTime: Number(Date.now()) };
          }
          if (epoch < Math.trunc(this.latestSlot.slot / this.config.get('FETCH_INTERVAL_SLOTS'))) {
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
      this.logger.error('Unexpected status code while fetching latest slot header');
      throw e;
    });
  }

  public async getBlockHeader(blockId: BlockId, ignoreCache = false): Promise<BlockHeaderResponse | void> {
    const cached = this.cache.get(String(blockId));
    if (!ignoreCache && cached != null && (cached.missed || cached.header)) {
      this.logger.debug(`Get ${blockId} header from blocks cache`);
      return cached.missed ? undefined : cached.header;
    }

    this.logger.debug(`Header for ${blockId} not found in blocks cache`);
    const blockHeader = await this.retryRequest<BlockHeaderResponse>(
      async (apiURL: string) => this.apiGet(apiURL, this.endpoints.beaconHeaders(blockId)),
      {
        maxRetries: this.config.get('CL_API_GET_BLOCK_INFO_MAX_RETRIES'),
        useFallbackOnRejected: (lastFallbackError, currFallbackError) => {
          if (lastFallbackError != null && lastFallbackError.$httpCode === 404 && currFallbackError.$httpCode !== 404) {
            this.logger.debug('Request error from last fallback was 404, but current is not. Will be used previous error');
            throw lastFallbackError;
          }

          return true;
        },
      },
    ).catch((e) => {
      if (e.$httpCode !== 404) {
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
   */
  public async getSlotHeaderOrPreviousIfMissedByParentRootHash(slot: Slot): Promise<BlockHeaderResponse> {
    const header = await this.getBlockHeader(slot);

    if (header) {
      return header;
    }

    // if block is missed, try to get next not missed block header
    const nextNotMissedHeader = await this.getNextNotMissedBlockHeader(slot, this.config.get('SPARSE_NETWORK_MODE'));

    this.logger.log(
      `Found next not missed slot [${nextNotMissedHeader.header.message.slot}] root [${nextNotMissedHeader.root}] after slot [${slot}]`,
    );

    // and get the closest block header by parent root from next
    const previousBlockHeader = <BlockHeaderResponse>await this.getBlockHeader(nextNotMissedHeader.header.message.parent_root);
    this.logger.log(`Block [${slot}] is missed. Returning previous not missed block header [${previousBlockHeader.header.message.slot}]`);

    return previousBlockHeader;
  }

  /**
   * Trying to get attester or proposer duty dependent block root
   */
  public async getDutyDependentRoot(epoch: Epoch, sparseMode = false, ignoreCache = false): Promise<string> {
    this.logger.log(`Getting duty dependent root for epoch [${epoch}]`);
    const dutyRootSlot = epoch * this.config.get('FETCH_INTERVAL_SLOTS') - 1;
    return (await this.getCurrentOrPreviousNotMissedBlockHeader(dutyRootSlot, sparseMode, this.defaultMaxSlotDeepCount, ignoreCache)).root;
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
    const cached = this.cache.get(String(blockId));
    if (cached != null && (cached.missed || cached.info)) {
      this.logger.debug(`Get ${blockId} info from blocks cache`);
      return cached.missed ? undefined : cached.info;
    }

    this.logger.debug(`Info for ${blockId} not found in blocks cache`);
    const blockInfo = await this.retryRequest<BlockInfoResponse>(
      async (apiURL: string) => this.apiGet(apiURL, this.endpoints.blockInfo(blockId)),
      {
        maxRetries: this.config.get('CL_API_GET_BLOCK_INFO_MAX_RETRIES'),
        useFallbackOnResolved: (r) => {
          if (this.workingMode === WorkingMode.Finalized && blockId !== 'head' && r.finalized != null && !r.finalized) {
            this.logger.error(`getBlockInfo: slot [${r.data.message.slot}] is not finalized`);
            return true;
          }

          return false;
        },
        useFallbackOnRejected: (lastFallbackError, currFallbackError) => {
          if (lastFallbackError != null && lastFallbackError.$httpCode === 404 && currFallbackError.$httpCode !== 404) {
            this.logger.debug('Request error from last fallback was 404, but current is not. Will be used previous error');
            throw lastFallbackError;
          }

          return true;
        },
      },
    ).catch((e) => {
      if (e.$httpCode !== 404) {
        this.logger.error('Unexpected status code while fetching block info');
        throw e;
      }
    });

    this.cache.set(String(blockId), { missed: !blockInfo, info: blockInfo });

    return blockInfo;
  }

  public async getAttestationCommitteesInfo(slot: Slot, epoch: Epoch): Promise<BodyReadable> {
    const slotEpoch = Math.trunc(slot / 32);
    if (epoch > slotEpoch + 1) {
      this.logger.warn(
        `getAttestationCommitteesInfo: got epoch [${epoch}] which is too far from target slot [${slot}]. Using epoch [${
          slotEpoch + 1
        }] instead.`,
      );
      epoch = slotEpoch + 1;
    }

    const { body }: BodyReadable = await this.retryRequest(
      async (apiURL: string) => await this.apiGetStream(apiURL, this.endpoints.attestationCommittees(slot, epoch)),
      {
        dataOnly: false,
      },
    );
    return body;
  }

  public async getSyncCommitteeInfo(stateId: StateId, epoch: Epoch): Promise<SyncCommitteeInfo> {
    return await this.retryRequest(async (apiURL: string) => this.apiGet(apiURL, this.endpoints.syncCommittee(stateId, epoch)), {
      useFallbackOnResolved: (r) => {
        if (this.workingMode === WorkingMode.Finalized && stateId !== 'head' && r.finalized != null && !r.finalized) {
          this.logger.error(`getSyncCommitteeInfo: state ${stateId} for epoch [${epoch}] is not finalized`);
          return true;
        }

        return false;
      },
    });
  }

  public async getCanonicalProposerDuties(
    epoch: Epoch,
    sparseMode = false,
    maxRetriesForGetCanonical = 3,
    ignoreCache = false,
  ): Promise<ProposerDutyInfo[]> {
    const retry = retrier(this.logger, maxRetriesForGetCanonical, 100, 10000, true);
    const request = async () => {
      const dependentRoot = await this.getDutyDependentRoot(epoch, sparseMode, ignoreCache);
      this.logger.log(`Proposer Duty root: ${dependentRoot}`);
      const res = <{ dependent_root: string; data: ProposerDutyInfo[] }>await this.retryRequest(
        async (apiURL: string) => this.apiGet(apiURL, this.endpoints.proposerDuties(epoch)),
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
      if (res != null) {
        break;
      }

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
        .catch((currentError: any) => {
          if (options.useFallbackOnRejected(err, currentError)) {
            err = currentError;
            return undefined;
          }

          throw currentError;
        });

      if (i === this.apiUrls.length - 1 && res == null) {
        err.message = `Error while doing CL API request on all passed URLs. ${err.message}`;
        throw err;
      }

      if (res == null) {
        this.logger.warn(`Error while doing CL API request. Will try to switch to another API URL. ${err.message}`);
      }
    }

    if (options.dataOnly) {
      return res.data;
    }

    return res;
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

  private async getNextNotMissedBlockHeader(
    slot: Slot,
    sparseMode = false,
    maxDeep = this.defaultMaxSlotDeepCount,
  ): Promise<BlockHeaderResponse> {
    if (sparseMode) {
      const epoch = Math.trunc(slot / 32);
      const lastNotMissedSlot = (await this.storage.getLastNotMissedSlotForEpoch(epoch - 1)).slot;
      this.logger.debug(`getNextNotMissedBlockHeader: Last known not missed slot before slot [${slot}] is [${lastNotMissedSlot}]`);

      return (await this.getSurroundingNotMissedBlockHeadersInSparseNetwork(slot, lastNotMissedSlot, maxDeep)).next;
    }

    return await this.getNextNotMissedBlockHeaderInDenseNetwork(slot, maxDeep);
  }

  private async getCurrentOrPreviousNotMissedBlockHeader(
    slot: Slot,
    sparseMode = false,
    maxDeep = this.defaultMaxSlotDeepCount,
    ignoreCache = false,
  ): Promise<BlockHeaderResponse> {
    if (sparseMode) {
      const epoch = Math.trunc(slot / 32);
      const lastNotMissedSlot = (await this.storage.getLastNotMissedSlotForEpoch(epoch - 1)).slot;
      this.logger.debug(
        `getCurrentOrPreviousNotMissedBlockHeader: Last known not missed slot before slot [${slot}] is [${lastNotMissedSlot}]`,
      );

      return (await this.getSurroundingNotMissedBlockHeadersInSparseNetwork(slot, lastNotMissedSlot, maxDeep)).previous;
    }

    return await this.getCurrentOrPreviousNotMissedBlockHeaderInDenseNetwork(slot, maxDeep, ignoreCache);
  }

  private async getNextNotMissedBlockHeaderInDenseNetwork(
    slot: Slot,
    maxDeep = this.defaultMaxSlotDeepCount,
  ): Promise<BlockHeaderResponse> {
    const initialMaxDeep = maxDeep;
    slot++;

    while (maxDeep >= 0) {
      const header = await this.getBlockHeader(slot);

      if (header) {
        return header;
      }

      if (maxDeep > 0) {
        this.logger.log(`Try to get next header from [${slot + 1}] slot because [${slot}] is missing`);
      }

      slot++;
      maxDeep--;
    }

    slot--;
    throw new MaxDeepError(`Error when trying to get next not missed block header. From ${slot - initialMaxDeep} to ${slot}`);
  }

  private async getCurrentOrPreviousNotMissedBlockHeaderInDenseNetwork(
    slot: Slot,
    maxDeep = this.defaultMaxSlotDeepCount,
    ignoreCache = false,
  ): Promise<BlockHeaderResponse> {
    const initialMaxDeep = maxDeep;

    while (maxDeep >= 0) {
      const header = await this.getBlockHeader(slot, ignoreCache);

      if (header) {
        return header;
      }

      if (maxDeep > 0) {
        this.logger.log(`Try to get previous header from [${slot - 1}] slot because [${slot}] is missing`);
      }

      slot--;
      maxDeep--;
    }

    slot++;
    throw new MaxDeepError(`Error when trying to get previous not missed block header. From ${slot + initialMaxDeep} to ${slot}`);
  }

  private async getSurroundingNotMissedBlockHeadersInSparseNetwork(
    targetSlot: Slot,
    previousKnownNotMissedSlot: Slot,
    maxDeep = this.defaultMaxSlotDeepCount,
  ): Promise<{ next: BlockHeaderResponse; previous: BlockHeaderResponse }> {
    if (previousKnownNotMissedSlot > targetSlot) {
      throw new Error(`Previous known not missed slot ${previousKnownNotMissedSlot} is greater than the target slot [${targetSlot}]`);
    }

    if (previousKnownNotMissedSlot == null || previousKnownNotMissedSlot === 0) {
      this.logger.warn(`Last not missed slot before slot [${targetSlot}] is unknown`);

      const next = await this.getNextNotMissedBlockHeaderInDenseNetwork(targetSlot, maxDeep);
      const previous = await this.getCurrentOrPreviousNotMissedBlockHeaderInDenseNetwork(targetSlot, maxDeep);

      this.logger.log(
        `Surrounding not missed slots for slot [${targetSlot}] are [${previous.header.message.slot}, ${next.header.message.slot}]`,
      );
      return { next, previous };
    }

    let slot = previousKnownNotMissedSlot;
    let previousSlot = previousKnownNotMissedSlot;
    while (slot <= targetSlot) {
      this.logger.log(`Try to get next not missed slot after slot [${slot}]`);

      previousSlot = slot;
      const slotInfo = await this.getBlockInfo(slot);
      if (!slotInfo) {
        this.logger.warn(`Got [${slot}] as latest known not missed slot, but it is missing`);

        const next = await this.getNextNotMissedBlockHeaderInDenseNetwork(targetSlot, maxDeep);
        const previous = await this.getCurrentOrPreviousNotMissedBlockHeaderInDenseNetwork(targetSlot, maxDeep);

        this.logger.log(
          `Surrounding not missed slots for slot [${targetSlot}] are [${previous.header.message.slot}, ${next.header.message.slot}]`,
        );
        return { next, previous };
      }

      const slotTime = await this.getSlotTime(slot);
      const blockNumber = Number(slotInfo.message.body.execution_payload.block_number);
      const nextBlockTime = await this.executionProvider.getBlockTimestamp(blockNumber + 1);

      slot = slot + (nextBlockTime - slotTime) / 12;

      for (let i = previousSlot + 1; i < slot; i++) {
        this.cache.set(String(i), {
          missed: true,
          header: undefined,
          info: undefined,
        });
      }
    }

    const nextHeader = await this.getBlockHeader(slot);
    if (!nextHeader) {
      throw new Error(`Slot [${slot}] is missing, but shouldn't`);
    }

    const previousHeader = await this.getBlockHeader(previousSlot);
    if (!previousHeader) {
      throw new Error(`Slot [${previousHeader}] is missing, but shouldn't`);
    }

    this.logger.log(
      `Surrounding not missed slots for slot [${targetSlot}] are [${previousHeader.header.message.slot}, ${nextHeader.header.message.slot}]`,
    );
    return { next: nextHeader, previous: previousHeader };
  }
}
