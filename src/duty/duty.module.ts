import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from '../common/eth-providers';
import { AttestationModule, AttestationService } from './attestation';
import { DutyService } from './duty.service';
import { ProposeModule, ProposeService } from './propose';
import { StateModule, StateService } from './state';
import { SyncModule, SyncService } from './sync';

@Module({
  imports: [AttestationModule, ProposeModule, StateModule, SyncModule, ConsensusProviderModule],
  providers: [DutyService, AttestationService, ProposeService, StateService, SyncService],
  exports: [DutyService, AttestationService, ProposeService, StateService, SyncService],
})
export class DutyModule {}
