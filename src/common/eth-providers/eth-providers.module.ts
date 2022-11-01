import { Module } from '@nestjs/common';

import { ConsensusProviderModule, ConsensusProviderService } from './consensus-provider';
import { BlockCacheModule } from './consensus-provider/block-cache';
import { ExecutionProviderModule, ExecutionProviderService } from './execution-provider';

@Module({
  imports: [ExecutionProviderModule, ConsensusProviderModule, BlockCacheModule],
  providers: [ExecutionProviderService, ConsensusProviderService],
  exports: [ExecutionProviderService, ConsensusProviderService],
})
export class EthProvidersModule {}
