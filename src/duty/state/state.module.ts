import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/consensus-provider';
import { SummaryModule } from 'duty/summary';
import { ClickhouseModule } from 'storage/clickhouse';

import { StateMetrics } from './state.metrics';
import { StateService } from './state.service';

@Module({
  imports: [ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [StateService, StateMetrics],
  exports: [StateService, StateMetrics],
})
export class StateModule {}
