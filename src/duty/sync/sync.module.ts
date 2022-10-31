import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';

import { SummaryModule } from '../summary';
import { SyncService } from './sync.service';

@Module({
  imports: [ConsensusProviderModule, SummaryModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
