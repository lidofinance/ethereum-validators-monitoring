import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';

import { SummaryModule } from '../summary';
import { AttestationService } from './attestation.service';

@Module({
  imports: [ConsensusProviderModule, SummaryModule],
  providers: [AttestationService],
  exports: [AttestationService],
})
export class AttestationModule {}
