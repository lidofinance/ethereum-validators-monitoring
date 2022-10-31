import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';
import { ClickhouseModule } from 'storage/clickhouse';

import { SummaryModule } from '../summary';
import { StateService } from './state.service';

@Module({
  imports: [ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [StateService],
  exports: [StateService],
})
export class StateModule {}
