import { Module } from '@nestjs/common';
import { ExecutionProviderModule, ExecutionProviderService } from './execution-provider';
import { ConsensusProviderModule, ConsensusProviderService } from './consensus-provider';

@Module({
  imports: [ExecutionProviderModule, ConsensusProviderModule],
  providers: [ExecutionProviderService, ConsensusProviderService],
  exports: [ExecutionProviderService, ConsensusProviderService],
})
export class EthProvidersModule {}
