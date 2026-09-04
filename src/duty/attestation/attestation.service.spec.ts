import { BitArray } from '@chainsafe/ssz';

import { SummaryService } from 'duty/summary';

import { AttestationService } from './attestation.service';

const SLOTS_PER_EPOCH = 32;
const EPOCH = 4;
const ATTESTED_SLOT = EPOCH * SLOTS_PER_EPOCH + 2;
const INCLUDED_IN_BLOCK = ATTESTED_SLOT + 1;
const VALIDATOR = 7;

const blockRoot = (slot: number) => `0xb10c${slot}`;
const payloadHash = (slot: number) => `0xpayload${slot}`;

/** Bid of a Gloas block: the payload it promises, and the payload the state already has */
const bid = (blockHash: string, parentBlockHash: string) => ({
  signed_execution_payload_bid: { message: { block_hash: blockHash, parent_block_hash: parentBlockHash } },
});

interface Options {
  /** Absent means the attested slot was missed, so the attester votes for the block of an earlier slot */
  proposedAtAttestedSlot?: boolean;
  /** Whether the including block applied the payload of its parent */
  parentPayloadApplied?: boolean;
  /** Up to Fulu the parent carries its payload itself and has no bid to read */
  parentWithoutBid?: boolean;
  gloasForkEpoch?: number;
}

const build = ({
  proposedAtAttestedSlot = true,
  parentPayloadApplied = true,
  parentWithoutBid = false,
  gloasForkEpoch = 0,
}: Options = {}) => {
  const parentSlot = ATTESTED_SLOT - 1;
  // With the attested slot missed the canonical root of it is the root of the block before it
  const rootAt = (slot: number) => (slot === ATTESTED_SLOT && !proposedAtAttestedSlot ? blockRoot(parentSlot) : blockRoot(slot));
  const parentOfIncluding = proposedAtAttestedSlot ? ATTESTED_SLOT : parentSlot;

  const blocks = new Map<string, any>([
    [
      String(INCLUDED_IN_BLOCK),
      {
        message: {
          slot: String(INCLUDED_IN_BLOCK),
          body: bid(payloadHash(INCLUDED_IN_BLOCK), payloadHash(parentPayloadApplied ? parentOfIncluding : parentOfIncluding - 1)),
        },
      },
    ],
    [
      blockRoot(parentOfIncluding),
      {
        message: {
          slot: String(parentOfIncluding),
          body: parentWithoutBid ? { execution_payload: { block_number: 1, withdrawals: [] } } : bid(payloadHash(parentOfIncluding), ''),
        },
      },
    ],
  ]);

  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const config = { get: (key: string) => (key === 'FETCH_INTERVAL_SLOTS' ? SLOTS_PER_EPOCH : undefined) };
  const clClient = {
    getForkEpochs: jest.fn(async () => ({ deneb: 0, electra: 0, gloas: gloasForkEpoch })),
    getSlotHeaderOrPreviousIfMissedByParentRootHash: jest.fn(async (slot: number) => ({ root: rootAt(slot) })),
    getBlockInfo: jest.fn(async (blockId: number | string) => blocks.get(String(blockId))),
    getBlockHeader: jest.fn(async (slot: number) =>
      slot === INCLUDED_IN_BLOCK ? { header: { message: { parent_root: blockRoot(parentOfIncluding) } } } : undefined,
    ),
  };
  const summary = new SummaryService();

  class TestAttestationService extends AttestationService {
    public process(attestation: any, committees: Map<string, number[]>): Promise<void> {
      return this.processAttestation(EPOCH, attestation, committees);
    }
  }

  const service = new TestAttestationService(logger as any, config as any, {} as any, clClient as any, summary);

  /**
   * An attestation that votes right on the roots, and on the payload as the caller says. With the attested slot missed,
   * the right root to vote for is the one of the block before it.
   */
  const attestation = (payloadVote: number) => ({
    includedInBlock: INCLUDED_IN_BLOCK,
    aggregationBits: BitArray.fromBoolArray([true]),
    committeeIndexes: [0],
    head: rootAt(ATTESTED_SLOT),
    targetRoot: blockRoot(EPOCH * SLOTS_PER_EPOCH),
    targetEpoch: EPOCH,
    sourceRoot: blockRoot((EPOCH - 1) * SLOTS_PER_EPOCH),
    sourceEpoch: EPOCH - 1,
    slot: ATTESTED_SLOT,
    committeeIndex: payloadVote,
    payloadVote,
  });

  return { service, summary, clClient, attestation };
};

const committees = new Map<string, number[]>([[`0_${ATTESTED_SLOT}`, [VALIDATOR]]]);

const headOf = (summary: SummaryService) => summary.epoch(EPOCH).get(VALIDATOR)?.att_valid_head;

describe('AttestationService head vote', () => {
  it('goes by the root alone up to Fulu, whatever the `data.index` of the attestation is', async () => {
    const { service, summary, clClient, attestation } = build({ gloasForkEpoch: Number.MAX_SAFE_INTEGER, proposedAtAttestedSlot: false });

    // `data.index` is a committee index up to Electra and is 0 from Electra on, so it says nothing about payloads and
    // must not be read as a vote
    await service.process(attestation(1), committees);

    expect(headOf(summary)).toBe(true);
    expect(clClient.getBlockHeader).not.toHaveBeenCalled();
  });

  it('goes by the root alone when the attested block was proposed in the slot it is attested to', async () => {
    // The builder reveals the payload later in the slot, so the attester cannot know about it yet. The spec has it vote
    // 0 and takes that as right, even though the payload did make it into the state
    const { service, summary, attestation } = build({ proposedAtAttestedSlot: true, parentPayloadApplied: true });

    await service.process(attestation(0), committees);

    expect(headOf(summary)).toBe(true);
  });

  it('grants the head flag on a missed slot when the payload vote is right', async () => {
    const { service, summary, attestation } = build({ proposedAtAttestedSlot: false, parentPayloadApplied: true });

    await service.process(attestation(1), committees);

    expect(headOf(summary)).toBe(true);
  });

  it('takes the head flag away on a missed slot when the payload vote is wrong', async () => {
    const { service, summary, attestation } = build({ proposedAtAttestedSlot: false, parentPayloadApplied: true });

    await service.process(attestation(0), committees);

    expect(headOf(summary)).toBe(false);
  });

  it('reads a skipped payload as absent, so a zero vote is the right one', async () => {
    const { service, summary, attestation } = build({ proposedAtAttestedSlot: false, parentPayloadApplied: false });

    await service.process(attestation(0), committees);

    expect(headOf(summary)).toBe(true);
  });

  it('takes the payload of a parent from before the fork as applied', async () => {
    // The fork sets every bit of `execution_payload_availability` to one, and such a parent has no bid to compare
    // hashes with
    const { service, summary, attestation } = build({ proposedAtAttestedSlot: false, parentWithoutBid: true });

    await service.process(attestation(1), committees);

    expect(headOf(summary)).toBe(true);
  });
});
