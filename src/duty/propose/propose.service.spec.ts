import { SummaryService } from 'duty/summary';

import { ProposeService } from './propose.service';

const SLOTS_PER_EPOCH = 32;
const EPOCH = 4;
const FIRST_SLOT = EPOCH * SLOTS_PER_EPOCH;
const LAST_SLOT = FIRST_SLOT + SLOTS_PER_EPOCH - 1;

const payloadHash = (slot: number) => `0xpayload${slot}`;

/** Body of a block up to Fulu, where the payload is a part of the block */
const inlineBlock = (slot: number) => ({
  message: {
    slot: String(slot),
    proposer_index: '1',
    body: { execution_payload: { block_number: 1, withdrawals: [] } },
  },
});

/**
 * Body of a Gloas block, which only commits to a bid. `appliedBefore` is the slot whose payload the state already
 * has, so pointing it at an earlier slot than the parent means the payload of the parent was skipped.
 */
const bidBlock = (slot: number, appliedBefore: number) => ({
  message: {
    slot: String(slot),
    proposer_index: '1',
    body: {
      signed_execution_payload_bid: {
        message: { block_hash: payloadHash(slot), parent_block_hash: payloadHash(appliedBefore) },
      },
    },
  },
});

/** `proposers` maps a slot of the epoch to the validator on duty for it; every listed slot has a block */
const build = (proposers: Record<number, number>, blocks: any[]) => {
  const bySlot = new Map<number, any>(blocks.map((b) => [Number(b.message.slot), b]));
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const configValues: Record<string, any> = { FETCH_INTERVAL_SLOTS: SLOTS_PER_EPOCH, SPARSE_NETWORK_MODE: false };
  const config = { get: (key: string) => configValues[key] };
  const prometheus = { taskDuration: { startTimer: () => () => 0 }, taskCount: { inc: jest.fn() } };
  const clClient = {
    getCanonicalProposerDuties: jest.fn(async () =>
      Object.entries(proposers).map(([slot, valId]) => ({ pubkey: '0x0', validator_index: String(valId), slot, proposed: false })),
    ),
    getBlockHeader: jest.fn(async (slot: number) =>
      bySlot.has(Number(slot)) ? { header: { message: { slot: String(slot) } } } : undefined,
    ),
    getBlockInfo: jest.fn(async (slot: number) => bySlot.get(Number(slot))),
    getNextProposedBlockInfo: jest.fn(async (slot: number) => {
      const after = [...bySlot.keys()].filter((s) => s > slot).sort((a, b) => a - b);
      return after.length > 0 ? bySlot.get(after[0]) : undefined;
    }),
  };
  const summary = new SummaryService();

  const service = new ProposeService(logger as any, config as any, prometheus as any, clClient as any, summary);

  return { service, summary, clClient, logger };
};

const proposalOf = (summary: SummaryService, valId: number) => summary.epoch(EPOCH).get(valId);

describe('ProposeService', () => {
  it('takes the payload as applied up to Fulu, without reading anything else', async () => {
    const { service, summary, clClient } = build({ [FIRST_SLOT]: 10 }, [inlineBlock(FIRST_SLOT)]);

    await service.check(EPOCH);

    expect(proposalOf(summary, 10)).toMatchObject({ block_proposed: true, block_payload_applied: true });
    // The payload is a part of the block, so no block outside the epoch is read for it
    expect(clClient.getNextProposedBlockInfo).not.toHaveBeenCalled();
  });

  it('marks the payload as applied since Gloas when the next block builds on it', async () => {
    const { service, summary } = build({ [FIRST_SLOT]: 10, [FIRST_SLOT + 1]: 11 }, [
      bidBlock(FIRST_SLOT, FIRST_SLOT - 1),
      bidBlock(FIRST_SLOT + 1, FIRST_SLOT),
    ]);

    await service.check(EPOCH);

    expect(proposalOf(summary, 10)).toMatchObject({ block_proposed: true, block_payload_applied: true });
  });

  it('marks the slot as empty when the next block builds on an older payload', async () => {
    // The bid of the second block points back at the payload before the first one, so the payload of the first block
    // was never applied: the block is there, the execution block is not
    const { service, summary, logger } = build({ [FIRST_SLOT]: 10, [FIRST_SLOT + 1]: 11 }, [
      bidBlock(FIRST_SLOT, FIRST_SLOT - 1),
      bidBlock(FIRST_SLOT + 1, FIRST_SLOT - 1),
    ]);

    await service.check(EPOCH);

    // The proposal itself is still a good one, only the payload is missing
    expect(proposalOf(summary, 10)).toMatchObject({ block_proposed: true, block_payload_applied: false });
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining(`Slot [${FIRST_SLOT}] is empty`));
  });

  it('reads the block after the epoch for the last proposed slot', async () => {
    const { service, summary, clClient } = build({ [LAST_SLOT]: 10 }, [
      bidBlock(LAST_SLOT, LAST_SLOT - 1),
      bidBlock(LAST_SLOT + 1, LAST_SLOT - 1),
    ]);

    await service.check(EPOCH);

    expect(clClient.getNextProposedBlockInfo).toHaveBeenCalledWith(LAST_SLOT);
    expect(proposalOf(summary, 10)).toMatchObject({ block_payload_applied: false });
  });

  it('takes the payload as applied when there is no block to compare with', async () => {
    const { service, summary } = build({ [LAST_SLOT]: 10 }, [bidBlock(LAST_SLOT, LAST_SLOT - 1)]);

    await service.check(EPOCH);

    expect(proposalOf(summary, 10)).toMatchObject({ block_proposed: true, block_payload_applied: true });
  });

  it('says nothing about the payload of a proposal that was missed', async () => {
    const { service, summary, clClient } = build({ [FIRST_SLOT]: 10 }, []);

    await service.check(EPOCH);

    expect(proposalOf(summary, 10)).toMatchObject({ is_proposer: true, block_to_propose: FIRST_SLOT, block_proposed: false });
    expect(proposalOf(summary, 10).block_payload_applied).toBeUndefined();
    expect(clClient.getBlockInfo).not.toHaveBeenCalled();
  });
});
