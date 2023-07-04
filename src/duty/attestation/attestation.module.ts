import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/consensus-provider';
import { SummaryModule } from 'duty/summary';
import { ClickhouseModule } from 'storage/clickhouse';

import { AttestationMetrics } from './attestation.metrics';
import { AttestationRewards } from './attestation.rewards';
import { AttestationService } from './attestation.service';

@Module({
  imports: [ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [AttestationService, AttestationMetrics, AttestationRewards],
  exports: [AttestationService, AttestationMetrics, AttestationRewards],
})
export class AttestationModule {}
