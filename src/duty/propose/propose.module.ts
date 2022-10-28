import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';

import { ProposeService } from './propose.service';

@Module({
  imports: [ConsensusProviderModule],
  providers: [ProposeService],
  exports: [ProposeService],
})
export class ProposeModule {}
