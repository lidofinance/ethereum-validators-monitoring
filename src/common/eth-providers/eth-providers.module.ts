import { Module } from '@nestjs/common';
import { ExecutionProviderModule, ExecutionProviderService } from './execution-provider';
import { ConsensusProviderModule, ConsensusProviderService, SlotsCacheService } from './consensus-provider';

@Module({
  imports: [ExecutionProviderModule, ConsensusProviderModule],
  providers: [ExecutionProviderService, ConsensusProviderService, SlotsCacheService],
  exports: [ExecutionProviderService, ConsensusProviderService, SlotsCacheService],
})
export class EthProvidersModule {}
