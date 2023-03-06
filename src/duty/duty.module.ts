import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/eth-providers';
import { BlockCacheModule } from 'common/eth-providers/consensus-provider/block-cache';
import { RegistryModule } from 'common/validators-registry';
import { ClickhouseModule } from 'storage/clickhouse';

import { AttestationModule } from './attestation';
import { DutyMetrics } from './duty.metrics';
import { DutyRewards } from './duty.rewards';
import { DutyService } from './duty.service';
import { ProposeModule } from './propose';
import { StateModule } from './state';
import { SummaryModule } from './summary';
import { SyncModule } from './sync';
import { WithdrawalsModule } from './withdrawal';

@Module({
  imports: [
    AttestationModule,
    ProposeModule,
    StateModule,
    SyncModule,
    WithdrawalsModule,
    SummaryModule,
    ConsensusProviderModule,
    BlockCacheModule,
    ClickhouseModule,
    RegistryModule,
  ],
  providers: [DutyService, DutyMetrics, DutyRewards],
  exports: [DutyService, DutyMetrics],
})
export class DutyModule {}
