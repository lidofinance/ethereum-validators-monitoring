import got, { HTTPError, Response } from 'got';
import { ResponseError, errCommon, errRequest } from './errors';
import { parseChunked } from '@discoveryjs/json-ext';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { PrometheusService } from '../../prometheus';
import { ConfigService } from '../../config';
import { bigintRange } from '../../functions/range';
import { retrier } from '../../functions/retrier';
import { rejectDelay } from '../../functions/rejectDelay';
import { urljoin } from '../../functions/urljoin';
import {
  AttesterDutyInfo,
  BlockHeaderResponse,
  FinalityCheckpointsResponse,
  GenesisResponse,
  ProposerDutyInfo,
  ShortBeaconBlockHeader,
  ShortBeaconBlockInfo,
  StateValidatorResponse,
  SyncCommitteeDutyInfo,
  SyncCommitteeInfo,
  VersionResponse,
} from './intefaces';

interface RequestRetryOptions {
  maxRetries?: number;
  dataOnly?: boolean;
  fallbackConditionCallback?: (e: any) => any;
}

@Injectable()
export class ConsensusProviderService {
  protected rpcUrls: { main: string; backup: string };
  protected version = '';
  protected genesisTime = 0n;
  protected defaultMaxSlotDeepCount = 32 * 5;

  protected endpoints = {
    version: 'eth/v1/node/version',
    genesis: 'eth/v1/beacon/genesis',
    beaconHeadFinalityCheckpoints: 'eth/v1/beacon/states/head/finality_checkpoints',
    blockInfo: (block: bigint | string): string => `eth/v2/beacon/blocks/${block}`,
    beaconHeaders: (slotOrBlockRoot: bigint | string): string => `eth/v1/beacon/headers/${slotOrBlockRoot}`,
    balances: (slotOrStateRoot: bigint | string): string => `eth/v1/beacon/states/${slotOrStateRoot}/validators`,
    syncCommittee: (slotOrStateRoot: bigint | string, epoch: bigint | string): string =>
      `eth/v1/beacon/states/${slotOrStateRoot}/sync_committees?epoch=${epoch}`,
    proposerDutes: (epoch: bigint | string): string => `eth/v1/validator/duties/proposer/${epoch}`,
    attesterDuties: (epoch: bigint | string): string => `eth/v1/validator/duties/attester/${epoch}`,
    syncCommitteeDuties: (epoch: bigint | string): string => `eth/v1/validator/duties/sync/${epoch}`,
  };

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
  ) {
    this.rpcUrls = {
      main: config.get('CL_BEACON_RPC_URL'),
      backup: config.get('CL_BEACON_RPC_URL_BACKUP') || '',
    };
  }

  public async getVersion(): Promise<string> {
    if (this.version) {
      return this.version;
    }
    const version = (await this.retryRequest<VersionResponse>((rpcURL: string) => this.apiGet(rpcURL, this.endpoints.version))).version;
    return (this.version = version);
  }

  public async getGenesisTime(): Promise<bigint> {
    if (this.genesisTime > 0) {
      return this.genesisTime;
    }

    const genesisTime = BigInt(
      (await this.retryRequest<GenesisResponse>((rpcURL: string) => this.apiGet(rpcURL, this.endpoints.genesis))).genesis_time,
    );
    this.logger.log(`Got genesis time [${genesisTime}] from Consensus Layer Client API`);
    return (this.genesisTime = genesisTime);
  }

  public async getFinalizedEpoch(): Promise<bigint> {
    return BigInt(
      (
        await this.retryRequest<FinalityCheckpointsResponse>((rpcURL: string) =>
          this.apiGet(rpcURL, this.endpoints.beaconHeadFinalityCheckpoints),
        )
      ).finalized.epoch,
    );
  }

  public async getBeaconBlockHeader(state: bigint | string, maxRetries = 3): Promise<ShortBeaconBlockHeader> {
    const blockHeader = await this.retryRequest<BlockHeaderResponse>(
      (rpcURL: string) => this.apiGet(rpcURL, this.endpoints.beaconHeaders(state)),
      { maxRetries, fallbackConditionCallback: (e) => 404 != e.$httpCode },
    );

    return {
      slotNumber: BigInt(blockHeader.header.message.slot),
      stateRoot: blockHeader.header.message.state_root,
      blockRoot: blockHeader.root,
      parentRoot: blockHeader.header.message.parent_root,
    };
  }

  public async getBeaconBlockHeaderOrPreviousIfMissed(slot: bigint): Promise<[ShortBeaconBlockHeader, boolean]> {
    try {
      return [await this.getBeaconBlockHeader(slot), false];
    } catch (e: any) {
      if (404 != e.$httpCode) {
        this.logger.error('Unexpected status code while fetching block header');
        throw e;
      }
      const someNotMissedNextBlock = await this.getNextNotMissedBlockHeader(slot);

      this.logger.log(
        `Found next not missed slot [${
          someNotMissedNextBlock.slotNumber
        }] root [${someNotMissedNextBlock.blockRoot.toString()}] after slot [${slot}]`,
      );

      const [isMissed, notMissedPreviousBlock] = await this.checkSlotIsMissed(slot, someNotMissedNextBlock);

      if (isMissed) {
        this.logger.log(`Slot [${slot}] is missed. Returning previous slot [${notMissedPreviousBlock.slotNumber}]`);
      }

      return [notMissedPreviousBlock, isMissed];
    }
  }

  public async getNextNotMissedBlockHeader(slot: bigint, maxDeep = this.defaultMaxSlotDeepCount): Promise<ShortBeaconBlockHeader> {
    try {
      return await this.getBeaconBlockHeader(slot);
    } catch (e: any) {
      if (404 != e.$httpCode) {
        this.logger.error('Unexpected status code while fetching block header');
        throw e;
      }
      if (maxDeep < 1) {
        throw e;
      }
      this.logger.log(`Getting next not missed slot [${slot + 1n}] max deep [${maxDeep - 1}]`);
      return await this.getNextNotMissedBlockHeader(slot + 1n, maxDeep - 1);
    }
  }

  public async getPreviousNotMissedBlockHeader(slot: bigint, maxDeep = this.defaultMaxSlotDeepCount): Promise<ShortBeaconBlockHeader> {
    try {
      return await this.getBeaconBlockHeader(slot);
    } catch (e: any) {
      if (404 != e.$httpCode) {
        this.logger.error('Unexpected status code while fetching block header');
        throw e;
      }
      if (maxDeep < 1) {
        throw e;
      }
      this.logger.log(`Getting previous not missed slot [${slot - 1n}] max deep [${maxDeep - 1}]`);
      return await this.getPreviousNotMissedBlockHeader(slot - 1n, maxDeep - 1);
    }
  }

  /**
   * Trying to get attester or proposer duty dependent block root
   */
  public async getDutyDependentRoot(epoch: bigint): Promise<string> {
    this.logger.log(`Getting duty dependent root for epoch ${epoch}`);
    const dutyRootSlot = epoch * 32n - 1n;
    return (await this.getPreviousNotMissedBlockHeader(dutyRootSlot)).blockRoot;
  }

  /**
   * Trying to get nearest block with slot attestation info.
   * Assumed that the ideal attestation is included in the next non-missed block
   */
  public async getBlockInfoWithSlotAttestations(
    slot: bigint,
    maxDeep = this.defaultMaxSlotDeepCount,
  ): Promise<[ShortBeaconBlockInfo | void, Array<string>]> {
    const nearestBlockIncludedAttestations = slot + 1n; // good attestation should be included to the next block
    let missedSlots: bigint[] = [];
    const blockInfo = await this.getNextNotMissedBlockInfo(nearestBlockIncludedAttestations, maxDeep);
    if (!blockInfo) {
      this.logger.error(`Error than trying to get nearest block with attestations for slot ${slot}: nearest ${maxDeep} blocks missed`);
      missedSlots = bigintRange(nearestBlockIncludedAttestations, nearestBlockIncludedAttestations + BigInt(maxDeep + 1));
    }

    if (blockInfo && nearestBlockIncludedAttestations != BigInt(blockInfo.message.slot)) {
      missedSlots = bigintRange(nearestBlockIncludedAttestations, BigInt(blockInfo.message.slot));
    }
    return [blockInfo, missedSlots.map((v) => v.toString())];
  }

  public async getNextNotMissedBlockInfo(slot: bigint, maxDeep = this.defaultMaxSlotDeepCount): Promise<ShortBeaconBlockInfo | undefined> {
    const blockInfo = await this.getBlockInfo(slot);
    if (!blockInfo) {
      if (maxDeep < 1) {
        return undefined;
      }
      this.logger.log(`Try to get info from ${slot + 1n} slot because ${slot} is missing`);
      return await this.getNextNotMissedBlockInfo(slot + 1n, maxDeep - 1);
    }
    return blockInfo;
  }

  public async checkSlotIsMissed(slotNumber: bigint, someNextBlock: ShortBeaconBlockHeader): Promise<[boolean, ShortBeaconBlockHeader]> {
    if (slotNumber > someNextBlock.slotNumber) {
      throw new Error('Next block is greater than probably missing block');
    }

    if (slotNumber === someNextBlock.slotNumber) {
      return [false, someNextBlock];
    }

    const blockHeader = await this.getBeaconBlockHeader(someNextBlock.parentRoot);

    if (slotNumber === blockHeader.slotNumber) {
      return [false, blockHeader];
    }

    if (slotNumber > blockHeader.slotNumber) {
      return [true, blockHeader];
    }

    return this.checkSlotIsMissed(slotNumber, blockHeader);
  }

  public async getBalances(stateRoot: string): Promise<StateValidatorResponse[]> {
    return await this.retryRequest((rpcURL: string) => this.apiLargeGet(rpcURL, this.endpoints.balances(stateRoot)));
  }

  public async getBlockInfo(block: string | bigint): Promise<ShortBeaconBlockInfo> {
    return <ShortBeaconBlockInfo>await this.retryRequest((rpcURL: string) => this.apiGet(rpcURL, this.endpoints.blockInfo(block)), {
      maxRetries: this.config.get('CL_GET_BLOCK_INFO_MAX_RETRIES'),
      fallbackConditionCallback: (e) => 404 != e.$httpCode,
    }).catch((e) => {
      if (404 != e.$httpCode) {
        this.logger.error('Unexpected status code while fetching block info');
        throw e;
      }
    });
  }

  public async getSyncCommitteeInfo(stateRoot: string, epoch: string | bigint): Promise<SyncCommitteeInfo> {
    return await this.retryRequest((rpcURL: string) => this.apiGet(rpcURL, this.endpoints.syncCommittee(stateRoot, epoch)));
  }

  public async getCanonicalAttesterDuties(
    epoch: string | bigint,
    dependentRoot: string,
    indexes: string[],
    maxRetries = 3,
  ): Promise<AttesterDutyInfo[]> {
    const retry = retrier(this.logger, maxRetries, 100, 10000, true);
    const request = async () => {
      const res = <{ dependent_root: string; data: AttesterDutyInfo[] }>(
        await this.retryRequest(
          (rpcURL: string) => this.apiLargePost(rpcURL, this.endpoints.attesterDuties(epoch), { body: JSON.stringify(indexes) }),
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
        throw Error(`Failed to get canonical attester duty info after ${maxRetries} retries`);
      });
  }

  public async getChunkedAttesterDuties(epoch: string | bigint, dependentRoot: string, indexes: string[]): Promise<AttesterDutyInfo[]> {
    let result: AttesterDutyInfo[] = [];
    const chunked = [...indexes];
    while (chunked.length > 0) {
      const chunk = chunked.splice(0, this.config.get('CL_POST_REQUEST_CHUNK_SIZE')); // large payload may cause endpoint exception
      result = result.concat(await this.getCanonicalAttesterDuties(epoch, dependentRoot, chunk));
    }
    return result;
  }

  public async getSyncCommitteeDuties(epoch: string | bigint, indexes: string[]): Promise<SyncCommitteeDutyInfo[]> {
    let result: SyncCommitteeDutyInfo[] = [];
    const chunked = [...indexes];
    while (chunked.length > 0) {
      const chunk = chunked.splice(0, this.config.get('CL_POST_REQUEST_CHUNK_SIZE')); // large payload may cause endpoint exception
      result = result.concat(
        <SyncCommitteeDutyInfo[]>await this.retryRequest((rpcURL: string) =>
          this.apiLargePost(rpcURL, this.endpoints.syncCommitteeDuties(epoch), { body: JSON.stringify(chunk) }),
        ).catch((e) => {
          this.logger.error('Unexpected status code while fetching sync committee duties info');
          throw e;
        }),
      );
    }
    return result;
  }

  public async getCanonicalProposerDuties(epoch: string | bigint, dependentRoot: string, maxRetries = 3): Promise<ProposerDutyInfo[]> {
    const retry = retrier(this.logger, maxRetries, 100, 10000, true);
    const request = async () => {
      const res = <{ dependent_root: string; data: ProposerDutyInfo[] }>await this.retryRequest(
        (rpcURL: string) => this.apiGet(rpcURL, this.endpoints.proposerDutes(epoch)),
        { maxRetries, dataOnly: false },
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
        throw Error(`Failed to get canonical proposer duty info after ${maxRetries} retries`);
      });
  }

  public async getSlotTime(slot: bigint): Promise<bigint> {
    return (await this.getGenesisTime()) + slot * BigInt(this.config.get('CHAIN_SLOT_TIME_SECONDS'));
  }

  protected async retryRequest<T>(callback: (rpcURL: string) => any, options?: RequestRetryOptions): Promise<T> {
    const [maxRetries, dataOnly, fallbackConditionCallback] = [
      options?.maxRetries ?? 5,
      options?.dataOnly != undefined ? options.dataOnly : true,
      options?.fallbackConditionCallback != undefined ? options.fallbackConditionCallback : () => true,
    ];
    const retry = retrier(this.logger, maxRetries, 100, 10000, true);
    const res = await callback(this.rpcUrls.main)
      .catch(rejectDelay(this.config.get('CL_BEACON_RPC_RETRY_DELAY_MS')))
      .catch(() => retry(() => callback(this.rpcUrls.main)))
      .catch((e: any) => {
        if (fallbackConditionCallback(e)) {
          if (!this.rpcUrls.backup) {
            this.logger.warn('Backup CL RPC url not passed');
            throw e;
          }
          this.logger.error('Error while doing CL RPC request. Will try to switch to another RPC');
          return retry(() => callback(this.rpcUrls.backup));
        }
        throw e;
      });

    if (dataOnly) return res.data;
    else return res;
  }

  protected apiGet = async <T>(rpcUrl: string, subUrl: string): Promise<T> => {
    return await this.prometheus.trackCLRequest(rpcUrl, subUrl, async () => {
      const res = await got
        .get(urljoin(rpcUrl, subUrl), { timeout: { response: this.config.get('CL_GET_RESPONSE_TIMEOUT') } })
        .catch((e) => {
          if (e.response) {
            throw new ResponseError(errRequest(e.response.body, subUrl, rpcUrl), e.response.statusCode);
          }
          throw new ResponseError(errCommon(e.message, subUrl, rpcUrl));
        });
      if (res.statusCode !== 200) {
        throw new ResponseError(errRequest(res.body, subUrl, rpcUrl), res.statusCode);
      }
      try {
        return JSON.parse(res.body);
      } catch (e) {
        throw new ResponseError(`Error converting response body to JSON. Body: ${res.body}`);
      }
    });
  };

  protected apiPost = async <T>(rpcUrl: string, subUrl: string, params?: Record<string, any>): Promise<T> => {
    return await this.prometheus.trackCLRequest(rpcUrl, subUrl, async () => {
      const res = await got
        .post(urljoin(rpcUrl, subUrl), { timeout: { response: this.config.get('CL_POST_RESPONSE_TIMEOUT') }, ...params })
        .catch((e) => {
          if (e.response) {
            throw new ResponseError(errRequest(e.response.body, subUrl, rpcUrl), e.response.statusCode);
          }
          throw new ResponseError(errCommon(e.message, subUrl, rpcUrl));
        });
      if (res.statusCode !== 200) {
        throw new ResponseError(errRequest(res.body, subUrl, rpcUrl), res.statusCode);
      }
      try {
        return JSON.parse(res.body);
      } catch (e) {
        throw new ResponseError(`Error converting response body to JSON. Body: ${res.body}`);
      }
    });
  };

  protected apiLargeGet = async (rpcUrl: string, subUrl: string): Promise<any> => {
    return await this.prometheus.trackCLRequest(rpcUrl, subUrl, async () => {
      return await parseChunked(
        got.stream
          .get(urljoin(rpcUrl, subUrl), { timeout: { response: this.config.get('CL_GET_RESPONSE_TIMEOUT') } })
          .on('response', (r: Response) => {
            if (r.statusCode != 200) throw new HTTPError(r);
          }),
      ).catch((e) => {
        if (e instanceof HTTPError) {
          throw new ResponseError(errRequest(<string>e.response.body, subUrl, rpcUrl), e.response.statusCode);
        }
        throw new ResponseError(errCommon(e.message, subUrl, rpcUrl));
      });
    });
  };

  protected apiLargePost = async (rpcUrl: string, subUrl: string, params?: Record<string, any>): Promise<any> => {
    return await this.prometheus.trackCLRequest(rpcUrl, subUrl, async () => {
      return await parseChunked(
        got.stream
          .post(urljoin(rpcUrl, subUrl), { timeout: { response: this.config.get('CL_POST_RESPONSE_TIMEOUT') }, ...params })
          .on('response', (r: Response) => {
            if (r.statusCode != 200) throw new HTTPError(r);
          }),
      ).catch((e) => {
        if (e instanceof HTTPError) {
          throw new ResponseError(errRequest(<string>e.response.body, subUrl, rpcUrl), e.response.statusCode);
        }
        throw new ResponseError(errCommon(e.message, subUrl, rpcUrl));
      });
    });
  };
}
