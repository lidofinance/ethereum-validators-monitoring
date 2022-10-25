import { Module } from '@nestjs/common';

import { BlockCacheService } from './block-cache.service';
import { ConsensusProviderService } from './consensus-provider.service';

@Module({
  providers: [ConsensusProviderService, BlockCacheService],
  exports: [ConsensusProviderService, BlockCacheService],
})
export class ConsensusProviderModule {}
