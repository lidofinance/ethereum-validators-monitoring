import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { BlockHeaderResponse, BlockInfoResponse } from './intefaces';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from 'common/config';

export interface CachedSlot {
  missed: boolean;
  header?: BlockHeaderResponse | void;
  info?: BlockInfoResponse | void;
}

@Injectable()
export class SlotsCacheService {
  constructor(@Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService, protected readonly config: ConfigService) {}

  private cache: { [slot: string]: CachedSlot } = {};

  public put(slot: string, cache: CachedSlot): void {
    this.cache[slot] = cache;
  }

  public update(slot: string, fresh: CachedSlot): void {
    const old = this.get(slot) ?? {};
    this.cache[slot] = { ...old, ...fresh };
  }

  public get(slot: string): CachedSlot {
    return this.cache[slot];
  }

  /**
   * Purge old slots from cache
   * @param epoch - current processed epoch
   */
  public purgeOld(epoch: bigint): void {
    let purged = 0;
    const firstSlotPrev = (epoch - 1n) * BigInt(this.config.get('FETCH_INTERVAL_SLOTS'));
    for (const slot of Object.keys(this.cache)) {
      // remove the oldest slots and all hashes
      if (slot.startsWith('0x') || BigInt(slot) < firstSlotPrev) {
        purged++;
        delete this.cache[slot];
      }
    }
    this.logger.debug(`Purged slots cache count: ${purged}`);
  }
}
