import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ClickhouseService } from '../storage';
import { AttestationService } from './attestation';
import { ProposeService } from './propose';
import { StateService } from './state';
import { SummaryService } from './summary';
import { SyncService } from './sync';

@Injectable()
export class DutyService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly state: StateService,
    protected readonly attestation: AttestationService,
    protected readonly propose: ProposeService,
    protected readonly sync: SyncService,
    protected readonly summary: SummaryService,
    protected readonly storage: ClickhouseService,
  ) {}

  /**
   *
   * @param args - epoch, slot, validatorsIndex, keysIndexed
   */
  public async check(args): Promise<any> {
    this.logger.log('Checking duties of validators');
    const { epoch, stateSlot, keysIndexed } = args;
    await Promise.all([
      this.state.check(epoch, stateSlot, keysIndexed),
      this.attestation.check(epoch, stateSlot),
      this.propose.check(epoch),
      this.sync.check(epoch, stateSlot),
    ]);
  }

  public async write(): Promise<any> {
    this.logger.log('Start writing summary of duties into DB');
    await this.storage.writeSummary(this.summary.values());
    this.summary.clear();
  }
}
