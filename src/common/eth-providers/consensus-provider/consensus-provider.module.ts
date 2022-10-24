import { Module } from '@nestjs/common';
import { ConsensusProviderService } from './consensus-provider.service';
import { BlockCacheService } from './block-cache.service';

@Module({
  providers: [ConsensusProviderService, BlockCacheService],
  exports: [ConsensusProviderService, BlockCacheService],
})
export class ConsensusProviderModule {}
