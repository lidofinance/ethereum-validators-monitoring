import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';

import { StateService } from './state.service';

@Module({
  imports: [ConsensusProviderModule],
  providers: [StateService],
  exports: [StateService],
})
export class StateModule {}
