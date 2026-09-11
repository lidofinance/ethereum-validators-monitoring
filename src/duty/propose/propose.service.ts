import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService, wasPayloadApplied } from 'common/consensus-provider';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { Epoch, Slot } from 'common/types/types';
import { SummaryService } from 'duty/summary';

@Injectable()
export class ProposeService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
  ) {}

  @TrackTask('check-proposer-duties')
  public async check(epoch: Epoch): Promise<void> {
    this.logger.log(`Start getting proposers duties info`);
    const sparseMode = this.config.get('SPARSE_NETWORK_MODE');
    const proposersDutyInfo = await this.clClient.getCanonicalProposerDuties(epoch, sparseMode);
    if (!proposersDutyInfo) {
      throw new Error(`Cannot get proposer duties for the epoch ${epoch}`);
    }

    this.logger.log(`Processing proposers duties info`);
    // Slots of the epoch that got a block, in order, with the validator that proposed it
    const proposers = new Map<Slot, number>();

    for (const prop of proposersDutyInfo) {
      const index = Number(prop.validator_index);
      const slot = Number(prop.slot);
      const blockHeader = await this.clClient.getBlockHeader(prop.slot);
      this.summary.epoch(epoch).set({
        epoch,
        val_id: index,
        is_proposer: true,
        block_to_propose: slot,
        block_proposed: !!blockHeader,
      });

      if (blockHeader) {
        proposers.set(slot, index);
      }
    }

    await this.checkPayloads(epoch, proposers);
  }

  /**
   * Whether the execution payload of every proposed block of the epoch was applied.
   *
   * Up to Fulu the payload is a part of the block, so the answer is always yes and no block is read twice for it.
   * Since Gloas (EIP-7732) the builder reveals the payload later in the slot, and the next proposer builds without it
   * when it does not come in time. Such a slot has a block but no execution block, and the spec calls it empty.
   *
   * Telling the two apart matters for two things. A proposer of an empty slot did its work and is paid all the same:
   * the builder owes the value of its bid whether it reveals the payload or not, and that payment settles either
   * along with the payload or at the end of the epoch, once the block has gathered the attestation weight
   * `process_builder_pending_payments` asks for. So this is not the same failure as a missed proposal, which earns
   * nothing at all. And empty slots take the timely head flag away from the attesters that voted the payload wrong, so
   * they explain a drop in attestation metrics that has nothing to do with the operators.
   */
  private async checkPayloads(epoch: Epoch, proposers: Map<Slot, number>): Promise<void> {
    // The duties come in order of slot, so the next entry is the next proposed block of the epoch
    const slots = [...proposers.keys()];

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const block = await this.clClient.getBlockInfo(slot);
      if (block == null) {
        continue;
      }

      let applied = wasPayloadApplied(
        block,
        i + 1 < slots.length ? await this.clClient.getBlockInfo(slots[i + 1]) : undefined,
        this.logger,
      );
      // Only the block after this one tells whether the payload was applied, and for the last block of the epoch it
      // has to be read. That block is past the epoch, so it may still be past the finalized head as well.
      if (applied == null) {
        applied = wasPayloadApplied(block, await this.clClient.getNextProposedBlockInfo(slot), this.logger);
      }

      if (applied === false) {
        this.logger.log(`Slot [${slot}] is empty: the block is there, but its execution payload was not applied`);
      }

      // Stays `undefined` when there is no block to compare with, and then the payload counts as applied: it almost
      // always was, and calling a good proposal empty is worse than missing an empty one
      this.summary.epoch(epoch).set({ epoch, val_id: proposers.get(slot), block_payload_applied: applied ?? true });
    }
  }
}
