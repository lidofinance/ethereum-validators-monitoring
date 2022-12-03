import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';
import { RegistryModule } from 'common/validators-registry';
import { ClickhouseModule } from 'storage/clickhouse';

import { SummaryModule } from '../summary';
import { AttestationMetrics } from './attestation.metrics';
import { AttestationRewards } from './attestation.rewards';
import { AttestationService } from './attestation.service';

@Module({
  imports: [RegistryModule, ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [AttestationService, AttestationMetrics, AttestationRewards],
  exports: [AttestationService, AttestationMetrics, AttestationRewards],
})
export class AttestationModule {}
