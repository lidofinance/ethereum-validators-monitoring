import { Module } from '@nestjs/common';
import { ExecutionProviderModule, ExecutionProviderService } from './execution-provider';
import { ConsensusProviderModule, ConsensusProviderService, BlockCacheService } from './consensus-provider';

@Module({
  imports: [ExecutionProviderModule, ConsensusProviderModule],
  providers: [ExecutionProviderService, ConsensusProviderService, BlockCacheService],
  exports: [ExecutionProviderService, ConsensusProviderService, BlockCacheService],
})
export class EthProvidersModule {}
