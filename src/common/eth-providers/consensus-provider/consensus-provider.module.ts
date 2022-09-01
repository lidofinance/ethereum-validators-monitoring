import { Module } from '@nestjs/common';
import { ConsensusProviderService } from './consensus-provider.service';

@Module({
  providers: [ConsensusProviderService],
  exports: [ConsensusProviderService],
})
export class ConsensusProviderModule {}
