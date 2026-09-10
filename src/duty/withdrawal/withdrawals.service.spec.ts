import { Withdrawal } from 'common/consensus-provider';
import { SummaryService } from 'duty/summary';

import { WithdrawalsService } from './withdrawals.service';

const SLOTS_PER_EPOCH = 32;
const MAX_SLOT_DEEP_COUNT = 4;
const EPOCH = 4;
const FIRST_SLOT = EPOCH * SLOTS_PER_EPOCH;
const LAST_SLOT = FIRST_SLOT + SLOTS_PER_EPOCH - 1;
// `BUILDER_INDEX_FLAG` from the Gloas spec, the same value the service uses
const BUILDER_INDEX_FLAG = 2 ** 40;

const withdrawal = (index: number, validatorIndex: number, amount: string): Withdrawal => ({
  index: String(index),
  validator_index: String(validatorIndex),
  address: '0xbeef',
  amount,
});

const payloadHash = (slot: number) => `0xpayload${slot}`;
const blockRoot = (slot: number) => `0xb10c${slot}`;

/** Body of a block up to Fulu, where the payload and its withdrawals are a part of the block */
const inlineBlock = (slot: number, withdrawals: Withdrawal[], parentSlot = slot - 1) => ({
  message: {
    slot: String(slot),
    proposer_index: '1',
    parent_root: blockRoot(parentSlot),
    body: { attestations: [], execution_payload: { block_number: 1, withdrawals } },
  },
});

/**
 * Body of a Gloas block, which only commits to a bid and has no payload of its own. `appliedBefore` is the slot whose
 * payload the state already has, so pointing it at an earlier slot than the parent means the parent payload was
 * skipped.
 */
const bidBlock = (slot: number, appliedBefore: number, parentSlot = slot - 1) => ({
  message: {
    slot: String(slot),
    proposer_index: '1',
    parent_root: blockRoot(parentSlot),
    body: {
      attestations: [],
      signed_execution_payload_bid: {
        message: { block_hash: payloadHash(slot), parent_block_hash: payloadHash(appliedBefore) },
      },
    },
  },
});

const envelope = (withdrawals: Withdrawal[]) => ({ message: { payload: { withdrawals } } });

const build = (blocks: any[], envelopes: Record<number, any> = {}, unreadableFrom = Infinity) => {
  const bySlot = new Map<number, any>(blocks.map((b) => [Number(b.message.slot), b]));
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const configValues: Record<string, any> = {
    FETCH_INTERVAL_SLOTS: SLOTS_PER_EPOCH,
    CL_API_MAX_SLOT_DEEP_COUNT: MAX_SLOT_DEEP_COUNT,
  };
  const config = { get: (key: string) => configValues[key] };
  const prometheus = { taskDuration: { startTimer: () => () => 0 }, taskCount: { inc: jest.fn() } };
  const slotByRoot = new Map<string, number>(blocks.map((b) => [blockRoot(Number(b.message.slot)), Number(b.message.slot)]));
  const clClient = {
    getBlockInfo: jest.fn(async (slot: number) => {
      if (slot >= unreadableFrom) {
        throw new Error(`slot [${slot}] is not finalized`);
      }

      return bySlot.get(slot);
    }),
    // Only ever asked for by root here, to turn the `parent_root` of a block into the slot of its parent
    getBlockHeader: jest.fn(async (root: string) => {
      const slot = slotByRoot.get(root);
      return slot != null ? { root, canonical: true, header: { message: { slot: String(slot) } } } : undefined;
    }),
    getExecutionPayloadEnvelope: jest.fn(async (slot: number) => envelopes[slot]),
  };
  const summary = new SummaryService();
  const unused = {} as any;

  const service = new WithdrawalsService(logger as any, config as any, prometheus as any, clClient as any, summary, unused, unused);

  return { service, summary, clClient, logger };
};

const withdrawnBy = (summary: SummaryService, valId: number) => summary.epoch(EPOCH).get(valId)?.val_balance_withdrawn;

describe('WithdrawalsService', () => {
  it('reads the withdrawals from the block itself up to Fulu', async () => {
    const { service, summary, clClient } = build([inlineBlock(FIRST_SLOT, [withdrawal(1, 10, '32'), withdrawal(2, 11, '64')])]);

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
    expect(withdrawnBy(summary, 11)).toBe(BigInt(64));
    expect(clClient.getExecutionPayloadEnvelope).not.toHaveBeenCalled();
    // Every block takes its own withdrawals, so no block outside the epoch is read
    expect(clClient.getBlockInfo).toHaveBeenCalledTimes(SLOTS_PER_EPOCH);
  });

  it('reads the withdrawals from the payload envelope since Gloas', async () => {
    const { service, summary, clClient } = build([bidBlock(FIRST_SLOT, FIRST_SLOT - 1), bidBlock(FIRST_SLOT + 1, FIRST_SLOT)], {
      [FIRST_SLOT]: envelope([withdrawal(1, 10, '32')]),
      [FIRST_SLOT + 1]: envelope([]),
    });

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
    expect(clClient.getExecutionPayloadEnvelope).toHaveBeenCalledWith(FIRST_SLOT);
  });

  it('handles an epoch where the fork happens and both block shapes are present', async () => {
    const { service, summary } = build([inlineBlock(FIRST_SLOT, [withdrawal(1, 10, '32')]), bidBlock(FIRST_SLOT + 1, FIRST_SLOT)], {
      [FIRST_SLOT + 1]: envelope([withdrawal(2, 11, '64')]),
    });

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
    expect(withdrawnBy(summary, 11)).toBe(BigInt(64));
  });

  it('counts a list once, at the slot that took it, when a later payload carries it', async () => {
    // The payload of the second slot was skipped: the third block points its bid at the payload of the first one. So
    // the third block took nothing, and the payload it does carry holds the list the second slot took
    const repeated = [withdrawal(1, 10, '32')];
    const { service, summary, clClient, logger } = build(
      [
        bidBlock(FIRST_SLOT, FIRST_SLOT - 1),
        bidBlock(FIRST_SLOT + 1, FIRST_SLOT),
        bidBlock(FIRST_SLOT + 2, FIRST_SLOT),
        bidBlock(FIRST_SLOT + 3, FIRST_SLOT + 2),
      ],
      {
        [FIRST_SLOT]: envelope([]),
        [FIRST_SLOT + 1]: envelope(repeated),
        [FIRST_SLOT + 2]: envelope(repeated),
        [FIRST_SLOT + 3]: envelope([]),
      },
    );

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
    // There is no payload to read for the slot that took the list, and the slot that carries it took nothing
    expect(clClient.getExecutionPayloadEnvelope).not.toHaveBeenCalledWith(FIRST_SLOT + 1);
    expect(logger.log).toHaveBeenCalledWith(
      `Withdrawals taken at slot [${FIRST_SLOT + 1}] are carried by the payload of slot [${FIRST_SLOT + 2}]`,
    );
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining(`Block [${FIRST_SLOT + 2}] took no withdrawals`));
  });

  it('counts a list the last slot of the epoch took, even when a payload after the epoch carries it', async () => {
    // The payload of the last slot was skipped, so its list only shows up after the epoch. It changed the balances
    // within the epoch all the same, and counting it in the next one would look like a drop of the balance here
    const { service, summary, logger } = build(
      [
        bidBlock(LAST_SLOT - 1, LAST_SLOT - 2),
        bidBlock(LAST_SLOT, LAST_SLOT - 1),
        bidBlock(LAST_SLOT + 1, LAST_SLOT - 1),
        bidBlock(LAST_SLOT + 2, LAST_SLOT + 1),
      ],
      {
        [LAST_SLOT - 1]: envelope([]),
        [LAST_SLOT + 1]: envelope([withdrawal(1, 10, '32')]),
      },
    );

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
    expect(logger.log).toHaveBeenCalledWith(
      `Withdrawals taken at slot [${LAST_SLOT}] are carried by the payload of slot [${LAST_SLOT + 1}]`,
    );
  });

  it('leaves out a list the epoch before took, even when a payload of this epoch carries it', async () => {
    // The payload of the last block of the epoch before was skipped, so the first block of this epoch took nothing and
    // only carries what that block took. Counting it here would look like a rise of the balance out of nowhere.
    // That block sits further back than `MAX_SLOT_DEEP_COUNT`, so it is only found by following `parent_root`
    const beforeEpoch = FIRST_SLOT - MAX_SLOT_DEEP_COUNT - 1;
    const { service, summary, clClient } = build(
      [bidBlock(beforeEpoch, beforeEpoch - 1), bidBlock(FIRST_SLOT, beforeEpoch - 1, beforeEpoch), bidBlock(FIRST_SLOT + 1, FIRST_SLOT)],
      {
        [FIRST_SLOT]: envelope([withdrawal(1, 10, '32')]),
        [FIRST_SLOT + 1]: envelope([]),
      },
    );

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBeUndefined();
    expect(clClient.getExecutionPayloadEnvelope).not.toHaveBeenCalledWith(FIRST_SLOT);
  });

  it('warns and counts the list all the same when the block before the epoch cannot be read', async () => {
    // With nothing to compare the first block of the epoch with, it has to count as one that took withdrawals
    const { service, summary, logger } = build([bidBlock(FIRST_SLOT, FIRST_SLOT - 2), bidBlock(FIRST_SLOT + 1, FIRST_SLOT)], {
      [FIRST_SLOT]: envelope([withdrawal(1, 10, '32')]),
      [FIRST_SLOT + 1]: envelope([]),
    });

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`Cannot read the block before slot [${FIRST_SLOT}]`));
  });

  it('takes the payload as applied when the next block of the last slot cannot be read', async () => {
    // The app processes an epoch as soon as its last slot is finalized, so the slot after it may be out of reach. The
    // payload almost always was applied, and losing an amount is worse than counting one twice
    const { service, summary, logger } = build(
      [bidBlock(LAST_SLOT, LAST_SLOT - 1)],
      { [LAST_SLOT]: envelope([withdrawal(1, 10, '32')]) },
      LAST_SLOT + 1,
    );

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining(`Cannot read block [${LAST_SLOT + 1}]`));
  });

  it('takes the payload as applied when the bids carry no hashes to compare', async () => {
    const bare = {
      message: {
        slot: String(FIRST_SLOT),
        proposer_index: '1',
        body: { attestations: [], signed_execution_payload_bid: { message: {} } },
      },
    };
    const { service, summary, logger } = build([bare, bidBlock(FIRST_SLOT + 1, FIRST_SLOT)], {
      [FIRST_SLOT]: envelope([withdrawal(1, 10, '32')]),
      [FIRST_SLOT + 1]: envelope([]),
    });

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('a bid hash is missing'));
  });

  it('warns when the payload was applied but the node has no envelope for it', async () => {
    const { service, summary, logger } = build([bidBlock(FIRST_SLOT, FIRST_SLOT - 1), bidBlock(FIRST_SLOT + 1, FIRST_SLOT)], {
      [FIRST_SLOT + 1]: envelope([]),
    });

    await service.check(EPOCH);

    expect(withdrawnBy(summary, 10)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`No execution payload envelope for slot [${FIRST_SLOT}]`));
  });

  it('leaves out the payments to builders that share the withdrawal list since Gloas', async () => {
    const { service, summary } = build([bidBlock(FIRST_SLOT, FIRST_SLOT - 1), bidBlock(FIRST_SLOT + 1, FIRST_SLOT)], {
      [FIRST_SLOT]: envelope([withdrawal(1, BUILDER_INDEX_FLAG + 3, '1000'), withdrawal(2, 10, '32')]),
      [FIRST_SLOT + 1]: envelope([]),
    });

    await service.check(EPOCH);

    expect(withdrawnBy(summary, BUILDER_INDEX_FLAG + 3)).toBeUndefined();
    expect([...summary.epoch(EPOCH).values()].map((v) => v.val_id)).toEqual([10]);
    expect(withdrawnBy(summary, 10)).toBe(BigInt(32));
  });
});
