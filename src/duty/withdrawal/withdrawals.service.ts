import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { BlockInfoResponse, ConsensusProviderService, Withdrawal } from 'common/consensus-provider';
import { allSettled } from 'common/functions/allSettled';
import { range } from 'common/functions/range';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { Epoch, Slot } from 'common/types/types';
import { SummaryService } from 'duty/summary';
import { ClickhouseService } from 'storage/clickhouse';
import { RegistryService } from 'validators-registry';

/**
 * `BUILDER_INDEX_FLAG` from the Gloas spec. Since Gloas the same withdrawal container is used for validators and for
 * builders, and this bit in `validator_index` tells which one it is.
 *
 * The code below compares with `>=` instead of testing the bit on purpose: bitwise operators in JS work on 32 bits and
 * would drop this one. The answer is the same, because a validator index is always below `VALIDATOR_REGISTRY_LIMIT`,
 * which is this very value.
 */
const BUILDER_INDEX_FLAG = 2 ** 40;

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
    // `blocks` keeps the order of the slots, so the next item is the next proposed block. It is the one that tells
    // whether the payload of this block was applied
    const blocksWithdrawals: Withdrawal[][] = await allSettled(blocks.map((b, i) => this.getWithdrawals(b, blocks[i + 1])));

    for (const withdrawals of blocksWithdrawals) {
      for (const withdrawal of withdrawals) {
        const valId = Number(withdrawal.validator_index);
        // A payment to a builder, not a withdrawal of a validator
        if (valId >= BUILDER_INDEX_FLAG) {
          continue;
        }

        const valBalanceWithdrawn = this.summary.epoch(epoch).get(valId)?.val_balance_withdrawn ?? BigInt(0);

        this.summary.epoch(epoch).set({
          epoch,
          val_id: valId,
          val_balance_withdrawn: valBalanceWithdrawn + BigInt(withdrawal.amount),
        });
      }
    }
  }

  /**
   * Withdrawals taken from the balances on the consensus layer while the block was being processed.
   *
   * Up to Fulu they are a part of the payload the block carries. Since Gloas (EIP-7732) `process_withdrawals` builds
   * the list from the state alone and takes the amounts from the balances right away, while the list itself is only
   * visible in the payload the builder reveals for this block.
   *
   * A payload that was skipped is left out here. Its list stays in `payload_expected_withdrawals`, and the next payload
   * that is applied has to carry the very same list, so the amounts are counted there instead of here. That keeps every
   * amount counted once, at the price of counting a few of them a slot or two later than the balance was changed.
   */
  private async getWithdrawals(block: BlockInfoResponse, nextInEpoch?: BlockInfoResponse): Promise<Withdrawal[]> {
    const payload = block.message.body.execution_payload;
    if (payload != null) {
      return payload.withdrawals ?? [];
    }

    const slot = Number(block.message.slot);
    const next = nextInEpoch ?? (await this.getNextProposedBlock(slot));
    // Stays `undefined` when there is no next block to compare with, and then the payload is taken as applied: it
    // almost always was, and an amount counted twice is easier to live with than one that is never counted at all
    const applied = next != null ? this.wasPayloadApplied(block, next) : undefined;

    if (applied === false) {
      this.logger.log(`Execution payload of slot [${slot}] was skipped, its withdrawals are counted at a later slot`);
      return [];
    }

    const envelope = await this.clClient.getExecutionPayloadEnvelope(slot);
    if (envelope == null) {
      const message = `No execution payload envelope for slot [${slot}], its withdrawals are not counted`;
      // The node has read and checked the payload it applied, so a missing envelope is a problem on its side. Without a
      // next block we do not know whether the payload was revealed at all, and then this is a normal thing to happen
      if (applied) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }

      return [];
    }

    return envelope.message.payload.withdrawals ?? [];
  }

  /**
   * Whether the payload of the block was applied to the state.
   *
   * Since Gloas (EIP-7732) the next proposer may build on the branch without the payload of the parent, if the builder
   * did not reveal it in time. Such a block commits to a payload whose parent is the payload of an earlier block, so
   * the hashes tell the two cases apart. `process_parent_execution_payload` makes the very same comparison.
   */
  private wasPayloadApplied(block: BlockInfoResponse, next: BlockInfoResponse): boolean {
    const blockHash = block.message.body.signed_execution_payload_bid?.message?.block_hash;
    const nextParentBlockHash = next.message.body.signed_execution_payload_bid?.message?.parent_block_hash;

    if (!blockHash || !nextParentBlockHash) {
      this.logger.warn(`Cannot tell if the payload of slot [${block.message.slot}] was applied, a bid hash is missing`);
      return true;
    }

    return blockHash === nextParentBlockHash;
  }

  /**
   * First proposed block after the slot, `undefined` when there is none to read.
   *
   * Only needed for the last proposed block of the epoch, since for every other one the next block is already at hand.
   * Reading it can fail: the app processes an epoch as soon as its last slot is finalized, so the slots right after the
   * epoch may still be past the finalized head.
   */
  private async getNextProposedBlock(slot: Slot): Promise<BlockInfoResponse | undefined> {
    const maxDeep = this.config.get('CL_API_MAX_SLOT_DEEP_COUNT');

    for (let next = slot + 1; next <= slot + maxDeep; next++) {
      try {
        const block = await this.clClient.getBlockInfo(next);
        if (block != null) {
          return block;
        }
      } catch {
        this.logger.log(`Cannot read block [${next}] to tell if the payload of slot [${slot}] was applied`);
        return undefined;
      }
    }

    this.logger.log(`No proposed block within [${maxDeep}] slots after slot [${slot}]`);
    return undefined;
  }
}
