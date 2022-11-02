import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';
import { RegistryModule } from 'common/validators-registry';
import { ClickhouseModule } from 'storage/clickhouse';

import { SummaryModule } from '../summary';
import { StateMetrics } from './state.metrics';
import { StateService } from './state.service';

@Module({
  imports: [RegistryModule, ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [StateService, StateMetrics],
  exports: [StateService, StateMetrics],
})
export class StateModule {}
