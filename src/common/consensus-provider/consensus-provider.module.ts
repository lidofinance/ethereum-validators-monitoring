import { Module } from '@nestjs/common';

import { ClickhouseModule } from 'storage/clickhouse';
import { ExecutionProviderModule } from '../execution-provider';
import { BlockCacheModule } from './block-cache';
import { ConsensusProviderService } from './consensus-provider.service';

@Module({
  imports: [BlockCacheModule, ClickhouseModule, ExecutionProviderModule],
  providers: [ConsensusProviderService],
  exports: [ConsensusProviderService],
})
export class ConsensusProviderModule {}
