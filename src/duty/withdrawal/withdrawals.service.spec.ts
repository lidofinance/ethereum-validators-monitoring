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

/** Body of a block up to Fulu, where the payload and its withdrawals are a part of the block */
const inlineBlock = (slot: number, withdrawals: Withdrawal[]) => ({
  message: {
    slot: String(slot),
    proposer_index: '1',
    body: { attestations: [], execution_payload: { block_number: 1, withdrawals } },
  },
});

/**
 * Body of a Gloas block, which only commits to a bid and has no payload of its own. `appliedBefore` is the slot whose
 * payload the state already has, so pointing it at an earlier slot than the parent means the parent payload was
 * skipped.
 */
const bidBlock = (slot: number, appliedBefore: number) => ({
  message: {
    slot: String(slot),
    proposer_index: '1',
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
  const clClient = {
    getBlockInfo: jest.fn(async (slot: number) => {
      if (slot >= unreadableFrom) {
        throw new Error(`slot [${slot}] is not finalized`);
      }

      return bySlot.get(slot);
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

  it('counts the list of a skipped payload at the later slot that applied it, and only there', async () => {
    // The payload of the second slot was skipped: the third block points its bid at the payload of the first one. The
    // state keeps the list of the second slot, so both envelopes carry it
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
    expect(clClient.getExecutionPayloadEnvelope).not.toHaveBeenCalledWith(FIRST_SLOT + 1);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining(`Execution payload of slot [${FIRST_SLOT + 1}] was skipped`));
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
