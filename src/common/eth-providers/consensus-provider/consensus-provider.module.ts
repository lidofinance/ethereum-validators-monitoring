import { Module } from '@nestjs/common';
import { ConsensusProviderService } from './consensus-provider.service';
import { SlotsCacheService } from './slots-cache.service';

@Module({
  providers: [ConsensusProviderService, SlotsCacheService],
  exports: [ConsensusProviderService, SlotsCacheService],
})
export class ConsensusProviderModule {}
