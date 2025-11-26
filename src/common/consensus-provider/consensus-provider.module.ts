import { Module } from '@nestjs/common';

import { ClickhouseModule } from 'storage/clickhouse';

import { BlockCacheModule } from './block-cache';
import { ConsensusProviderService } from './consensus-provider.service';
import { ExecutionProviderModule } from '../execution-provider';

@Module({
  imports: [BlockCacheModule, ClickhouseModule, ExecutionProviderModule],
  providers: [ConsensusProviderService],
  exports: [ConsensusProviderService],
})
export class ConsensusProviderModule {}
