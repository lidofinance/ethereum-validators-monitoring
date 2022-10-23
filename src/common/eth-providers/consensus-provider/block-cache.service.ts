import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { BlockHeaderResponse, BlockInfoResponse } from './intefaces';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';
import { Epoch, RootHex, Slot } from './types';

export interface BlockCache {
  missed: boolean;
  header?: BlockHeaderResponse | void;
  info?: BlockInfoResponse | void;
}

type BlockCacheId = Slot | RootHex;

@Injectable()
export class BlockCacheService {
  constructor(@Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService, protected readonly config: ConfigService) {}

  private cache: { [slot: string]: BlockCache } = {};

  public put(blockId: BlockCacheId, cache: BlockCache): void {
    this.cache[String(blockId)] = cache;
  }

  public update(blockId: BlockCacheId, fresh: BlockCache): void {
    // save only by slot number or root
    if (['finalized', 'head'].includes(String(blockId))) return;
    this.logger.debug(`Update ${blockId} ${Object.keys(fresh)} in slots cache`);
    const old = this.get(String(blockId)) ?? {};
    this.cache[String(blockId)] = { ...old, ...fresh };
  }

  public get(blockId: BlockCacheId): BlockCache {
    return this.cache[String(blockId)];
  }

  /**
   * Purge old blocks from cache
   * @param epoch - current processed epoch
   */
  public purgeOld(epoch: Epoch): void {
    let purged = 0;
    const firstSlotPrevEpoch = (epoch - 1n) * BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    for (const blockId of Object.keys(this.cache)) {
      // Data can be cached by block's root. Managing the lifetime of such records is not trivial at this moment
      // In order for this to be possible it is necessary
      // todo:
      //   - save data to cache by composite Id: slot number + root
      //   - get data by one of part of multiply id: slot number or root
      if (blockId.startsWith('0x') || BigInt(blockId) < firstSlotPrevEpoch) {
        purged++;
        delete this.cache[blockId];
      }
    }
    this.logger.debug(`Purged slots cache count: ${purged}`);
  }
}
