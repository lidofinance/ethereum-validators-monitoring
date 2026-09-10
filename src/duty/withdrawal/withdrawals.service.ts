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
    const epochWithdrawals = await this.getEpochWithdrawals(firstSlotInEpoch, blocks);

    for (const withdrawal of epochWithdrawals) {
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

  /**
   * Withdrawals taken from the balances on the consensus layer within the epoch.
   *
   * Up to Fulu every block takes its withdrawals and carries them in the payload of the same block, so the list is
   * right there and belongs to the slot it was read from.
   *
   * Since Gloas (EIP-7732) the two steps come apart:
   *
   * - `process_withdrawals` takes the amounts from the balances while the block is being processed, but it runs only
   *   when the payload of the parent block was applied. A block that follows a skipped payload takes nothing at all.
   * - The list it built goes into `state.payload_expected_withdrawals`, and the first payload applied from then on has
   *   to carry that very list. So the list of a block whose own payload was skipped only shows up a slot or two later.
   *
   * The walk below follows both steps, so that every amount is counted once and in the epoch whose balances it
   * changed. The block before the epoch takes part in the walk too, because a list taken there can be carried by a
   * payload within the epoch, and such a list belongs to the epoch before this one.
   */
  private async getEpochWithdrawals(firstSlotInEpoch: Slot, blocks: BlockInfoResponse[]): Promise<Withdrawal[]> {
    const maxDeep = this.config.get('CL_API_MAX_SLOT_DEEP_COUNT');
    const lastSlotInEpoch = firstSlotInEpoch + this.config.get('FETCH_INTERVAL_SLOTS') - 1;
    const previous = await this.getBlockBeforeEpoch(blocks[0]);
    const chain = previous != null ? [previous, ...blocks] : [...blocks];
    const withdrawals: Withdrawal[] = [];

    const takenInEpoch = (slot: Slot | undefined): slot is Slot => slot != null && slot >= firstSlotInEpoch && slot <= lastSlotInEpoch;

    // Slot whose block took withdrawals from the balances, while the list of them is still to be found
    let takenAt: Slot | undefined = undefined;
    // Whether the payload of the block before the one the walk is at was applied. The block the walk opens with is
    // taken to follow an applied payload: nothing it takes is counted here anyway, unless it is the first block of the
    // epoch, and then there is nothing better to assume.
    let previousApplied = true;

    for (let i = 0; i < chain.length; i++) {
      const block = chain[i];
      const slot = Number(block.message.slot);

      if (previousApplied) {
        takenAt = slot;
      } else {
        this.logger.log(`Block [${slot}] took no withdrawals, the payload of its parent was not applied`);
      }

      let applied = this.wasPayloadApplied(block, chain[i + 1]);
      // Only the block after this one tells whether the payload was applied. Past the end of the epoch such a block is
      // read one by one, and only while a list taken within the epoch is still to be found.
      if (applied == null && takenInEpoch(takenAt) && slot < lastSlotInEpoch + maxDeep) {
        const next = await this.getNextProposedBlock(slot, maxDeep);
        if (next != null) {
          chain.push(next);
          applied = this.wasPayloadApplied(block, next);
        }
      }

      // Stays `undefined` when there is no next block to compare with, and then the payload is taken as applied: it
      // almost always was, and an amount counted twice is easier to live with than one that is never counted at all
      previousApplied = applied ?? true;
      if (!previousApplied) {
        continue;
      }

      if (takenInEpoch(takenAt)) {
        withdrawals.push(...(await this.getCarriedWithdrawals(block, takenAt, applied)));
      }

      takenAt = undefined;
    }

    return withdrawals;
  }

  /**
   * The list of withdrawals the payload of the block carries, taken at slot `takenAt`.
   *
   * Up to Fulu the payload is a part of the block. Since Gloas (EIP-7732) the builder reveals it in an envelope of its
   * own, and `takenAt` is an earlier slot whenever the payloads in between were skipped.
   */
  private async getCarriedWithdrawals(block: BlockInfoResponse, takenAt: Slot, applied?: boolean): Promise<Withdrawal[]> {
    const payload = block.message.body.execution_payload;
    if (payload != null) {
      return payload.withdrawals ?? [];
    }

    const slot = Number(block.message.slot);
    if (slot !== takenAt) {
      this.logger.log(`Withdrawals taken at slot [${takenAt}] are carried by the payload of slot [${slot}]`);
    }

    const envelope = await this.clClient.getExecutionPayloadEnvelope(slot);
    if (envelope == null) {
      const message = `No execution payload envelope for slot [${slot}], the withdrawals taken at slot [${takenAt}] are not counted`;
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
   * Whether the payload of the block was applied to the state, `undefined` when there is no block after it to tell.
   *
   * Up to Fulu the payload is a part of the block, so it is always applied. Since Gloas (EIP-7732) the next proposer
   * may build on the branch without the payload of the parent, if the builder did not reveal it in time. Such a block
   * commits to a payload whose parent is the payload of an earlier block, so the hashes tell the two cases apart.
   * `process_parent_execution_payload` makes the very same comparison.
   */
  private wasPayloadApplied(block: BlockInfoResponse, next?: BlockInfoResponse): boolean | undefined {
    if (block.message.body.execution_payload != null) {
      return true;
    }

    if (next == null) {
      return undefined;
    }

    const blockHash = block.message.body.signed_execution_payload_bid?.message?.block_hash;
    const nextParentBlockHash = next.message.body.signed_execution_payload_bid?.message?.parent_block_hash;

    if (!blockHash || !nextParentBlockHash) {
      this.logger.warn(`Cannot tell if the payload of slot [${block.message.slot}] was applied, a bid hash is missing`);
      return true;
    }

    return blockHash === nextParentBlockHash;
  }

  /**
   * The block right before the first block of the epoch, `undefined` when it is not needed or cannot be read.
   *
   * It is only needed when the first block of the epoch carries no payload of its own, because up to Fulu every block
   * takes its withdrawals and the block before it changes nothing.
   *
   * The parent is looked up by its root, so that however many slots before the epoch were missed, it is still found.
   * Its body is then read by slot, because that is the key the prefetch fills the cache by.
   */
  private async getBlockBeforeEpoch(first: BlockInfoResponse | undefined): Promise<BlockInfoResponse | undefined> {
    if (first == null || first.message.body.execution_payload != null) {
      return undefined;
    }

    const parent = await this.getParentBlock(first).catch(() => undefined);
    if (parent == null) {
      // Without it the first block of the epoch counts as one that took withdrawals, and then a list the epoch before
      // has already counted can be counted here as well
      this.logger.warn(`Cannot read the block before slot [${first.message.slot}], its withdrawals may be counted twice`);
    }

    return parent;
  }

  private async getParentBlock(block: BlockInfoResponse): Promise<BlockInfoResponse | undefined> {
    const parentRoot = block.message.parent_root;
    if (!parentRoot) {
      return undefined;
    }

    const parentSlot = (await this.clClient.getBlockHeader(parentRoot))?.header.message.slot;
    return parentSlot != null ? await this.clClient.getBlockInfo(Number(parentSlot)) : undefined;
  }

  /**
   * First proposed block after the slot, `undefined` when there is none to read.
   *
   * Only needed past the end of the epoch, since within it the next block is already at hand. Reading it can fail: the
   * app processes an epoch as soon as its last slot is finalized, so the slots right after the epoch may still be past
   * the finalized head.
   */
  private async getNextProposedBlock(slot: Slot, maxDeep: number): Promise<BlockInfoResponse | undefined> {
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
