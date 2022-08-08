import { Module } from '@nestjs/common';

import { ConsensusClientService } from './consensus/consensus-client.service';
import { NodeOperatorsContractService } from './execution/node-operators-contract.service';
import { StethContractService } from './execution/steth-contract-service';

@Module({
  providers: [ConsensusClientService, NodeOperatorsContractService, StethContractService],
  exports: [ConsensusClientService, NodeOperatorsContractService, StethContractService],
})
export class EthereumModule {}
