import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';

import { AttestationService } from './attestation.service';

@Module({
  imports: [ConsensusProviderModule],
  providers: [AttestationService],
  exports: [AttestationService],
})
export class AttestationModule {}
