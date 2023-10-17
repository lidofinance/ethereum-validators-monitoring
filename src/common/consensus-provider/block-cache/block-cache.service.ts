import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';

import { BlockHeaderResponse, BlockInfoResponse } from '../intefaces';
import { Epoch, RootHex, Slot } from '../types';

export interface BlockCache {
  missed: boolean;
  header?: BlockHeaderResponse | void;
  info?: BlockInfoResponse | void;
}

type BlockCacheId = Slot | RootHex;

@Injectable()
export class BlockCacheService {
  protected cache: Map<string, BlockCache>;
  constructor(@Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService, protected readonly config: ConfigService) {
    this.cache = new Map<string, BlockCache>();
  }

  public set(blockId: BlockCacheId, data: BlockCache): void {
    // save only by slot number or root
    if (['finalized', 'head'].includes(String(blockId))) return;
    this.logger.debug(`Set ${blockId} ${Object.keys(data)} to blocks cache`);
    const existing = this.get(String(blockId)) ?? {};
    this.cache.set(String(blockId), { ...existing, ...data });
  }

  public get(blockId: BlockCacheId): BlockCache {
    return this.cache.get(String(blockId));
  }

  /**
   * Purge old blocks from cache
   * @param epoch - current processed epoch
   */
  public purgeOld(epoch: Epoch): void {
    let purged = 0;
    const firstSlotPrevEpoch = (epoch - 2) * this.config.get('FETCH_INTERVAL_SLOTS');
    for (const blockId of this.cache.keys()) {
      // Data can be cached by block's root. Managing the lifetime of such records is not trivial at this moment
      // In order for this to be possible it is necessary
      // todo:
      //   - save data to cache by composite Id: slot number + root
      //   - get data by one of part of multiply id: slot number or root
      if (blockId.startsWith('0x') || Number(blockId) < firstSlotPrevEpoch) {
        purged++;
        this.cache.delete(blockId);
      }
    }
    this.logger.debug(`Purged blocks cache count: ${purged}`);
  }

  public clear() {
    this.cache.clear();
  }
}
