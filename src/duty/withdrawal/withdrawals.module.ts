import { Module } from '@nestjs/common';

import { ConsensusProviderModule } from 'common/consensus-provider';
import { SummaryModule } from 'duty/summary';
import { ClickhouseModule } from 'storage/clickhouse';

import { WithdrawalsMetrics } from './withdrawals.metrics';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [ConsensusProviderModule, ClickhouseModule, SummaryModule],
  providers: [WithdrawalsService, WithdrawalsMetrics],
  exports: [WithdrawalsService, WithdrawalsMetrics],
})
export class WithdrawalsModule {}
