import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';

import { SyncService } from './sync.service';

@Module({
  imports: [ConsensusProviderModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
