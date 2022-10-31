import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';

import { SummaryModule } from '../summary';
import { ProposeService } from './propose.service';

@Module({
  imports: [ConsensusProviderModule, SummaryModule],
  providers: [ProposeService],
  exports: [ProposeService],
})
export class ProposeModule {}
