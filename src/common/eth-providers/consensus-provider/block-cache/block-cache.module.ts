import { Module } from '@nestjs/common';

import { BlockCacheService } from './block-cache.service';

@Module({
  providers: [BlockCacheService],
  exports: [BlockCacheService],
})
export class BlockCacheModule {}
