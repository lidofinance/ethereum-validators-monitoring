import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';
import { ClickhouseModule } from 'storage/clickhouse';

import { AttestationModule, AttestationService } from './attestation';
import { DutyMetrics } from './duty.metrics';
import { DutyService } from './duty.service';
import { ProposeModule, ProposeService } from './propose';
import { StateModule, StateService } from './state';
import { SummaryModule, SummaryService } from './summary';
import { SyncModule, SyncService } from './sync';

@Module({
  imports: [AttestationModule, ProposeModule, StateModule, SyncModule, SummaryModule, ConsensusProviderModule, ClickhouseModule],
  providers: [DutyService, DutyMetrics, AttestationService, ProposeService, StateService, SyncService, SummaryService],
  exports: [DutyService, DutyMetrics, AttestationService, ProposeService, StateService, SyncService, SummaryService],
})
export class DutyModule {}
