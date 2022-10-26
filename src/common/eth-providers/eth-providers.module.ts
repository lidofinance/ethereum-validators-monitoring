import { Module } from '@nestjs/common';

import { BlockCacheService, ConsensusProviderModule, ConsensusProviderService } from './consensus-provider';
import { ExecutionProviderModule, ExecutionProviderService } from './execution-provider';

@Module({
  imports: [ExecutionProviderModule, ConsensusProviderModule],
  providers: [ExecutionProviderService, ConsensusProviderService, BlockCacheService],
  exports: [ExecutionProviderService, ConsensusProviderService, BlockCacheService],
})
export class EthProvidersModule {}
