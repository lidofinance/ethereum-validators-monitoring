import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockInfoResponse, ConsensusProviderService } from 'common/consensus-provider';
import { Epoch } from 'common/consensus-provider/types';
import { allSettled } from 'common/functions/allSettled';
import { range } from 'common/functions/range';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { SummaryService } from 'duty/summary';
import { ClickhouseService } from 'storage/clickhouse';
import { RegistryService } from 'validators-registry';

@Injectable()
export class WithdrawalsService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
    protected readonly storage: ClickhouseService,
    protected readonly registry: RegistryService,
  ) {}

  @TrackTask('check-withdrawals')
  public async check(epoch: Epoch): Promise<void> {
    this.logger.log('Getting withdrawals for epoch');
    const slotsInEpoch = this.config.get('FETCH_INTERVAL_SLOTS');
    const firstSlotInEpoch = epoch * slotsInEpoch;
    const slots: number[] = range(firstSlotInEpoch, firstSlotInEpoch + slotsInEpoch);
    const toFetch = slots.map((s) => this.clClient.getBlockInfo(s));
    const blocks = (await allSettled(toFetch)).filter((b) => b != undefined) as BlockInfoResponse[];
    for (const block of blocks) {
      const withdrawals = block.message.body.execution_payload.withdrawals ?? [];
      for (const withdrawal of withdrawals) {
        this.summary.epoch(epoch).set({
          epoch,
          val_id: Number(withdrawal.validator_index),
          val_balance_withdrawn: BigInt(withdrawal.amount),
        });
      }
    }
  }
}
