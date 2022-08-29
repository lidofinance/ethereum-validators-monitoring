import { Module } from '@nestjs/common';

import { ConsensusClientService } from './consensus/consensus-client.service';

@Module({
  providers: [ConsensusClientService],
  exports: [ConsensusClientService],
})
export class EthereumModule {}
