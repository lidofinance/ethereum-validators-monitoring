import { BlockCacheService } from './block-cache';
import { ConsensusProviderService } from './consensus-provider.service';
import { ResponseError } from './errors';

const GENESIS_TIME = 1606824023;
const SLOTS_PER_EPOCH = 32;

const slotTime = (slot: number) => GENESIS_TIME + slot * 12;
const blockRoot = (slot: number) => `0xb10c${slot}`;
const executionBlockHash = (blockNumber: number) => `0x1e${blockNumber}`;

interface ProposedBlock {
  slot: number;
  /**
   * Number of the execution layer block of this slot's payload. Absent when the payload was never applied, which up to
   * Fulu cannot happen and since Gloas means the builder did not reveal it.
   */
  executionBlockNumber?: number;
}

/**
 * A chain of proposed blocks with everything in between missed, served over a stubbed `apiGet`, so that the caching and
 * the 404 handling of the provider stay under test together with the walk.
 */
class ChainFixture {
  public readonly executionTimestamps = new Map<number, number>();
  public readonly requestedSubUrls: string[] = [];
  private readonly bySlot = new Map<number, ProposedBlock>();
  private readonly slotByRoot = new Map<string, number>();

  public constructor(private readonly blocks: ProposedBlock[], private readonly fork: 'fulu' | 'gloas') {
    for (const block of blocks) {
      this.bySlot.set(block.slot, block);
      this.slotByRoot.set(blockRoot(block.slot), block.slot);

      if (block.executionBlockNumber != null) {
        this.executionTimestamps.set(block.executionBlockNumber, slotTime(block.slot));
      }
    }
  }

  public parentSlot(slot: number): number {
    const previous = this.blocks.filter((b) => b.slot < slot);
    return previous.length > 0 ? previous[previous.length - 1].slot : 0;
  }

  /** Number of the latest execution layer block applied to the state at the given slot */
  public appliedExecutionBlockNumber(slot: number): number {
    const applied = this.blocks.filter((b) => b.slot < slot && b.executionBlockNumber != null);
    return applied[applied.length - 1].executionBlockNumber;
  }

  public header(slot: number): unknown {
    return {
      root: blockRoot(slot),
      canonical: true,
      header: {
        message: {
          slot: String(slot),
          proposer_index: '1',
          parent_root: blockRoot(this.parentSlot(slot)),
          state_root: '0x0',
          body_root: '0x0',
        },
        signature: '0x0',
      },
    };
  }

  public info(slot: number): unknown {
    const block = this.bySlot.get(slot);
    const body =
      this.fork === 'fulu'
        ? { execution_payload: { block_number: block.executionBlockNumber, withdrawals: [] } }
        : { signed_execution_payload_bid: { message: { parent_block_hash: executionBlockHash(this.appliedExecutionBlockNumber(slot)) } } };

    return {
      message: {
        slot: String(slot),
        proposer_index: '1',
        body: { attestations: [], sync_aggregate: { sync_committee_bits: '0x0' }, ...body },
      },
    };
  }

  public resolve(subUrl: string): unknown {
    this.requestedSubUrls.push(subUrl);

    const headers = subUrl.match(/^eth\/v1\/beacon\/headers\/(.+)$/);
    if (headers) {
      const slot = this.slotOf(headers[1]);
      return this.bySlot.has(slot) ? { data: this.header(slot) } : this.notFound(subUrl);
    }

    const blocks = subUrl.match(/^eth\/v2\/beacon\/blocks\/(.+)$/);
    if (blocks) {
      const slot = this.slotOf(blocks[1]);
      return this.bySlot.has(slot) ? { data: this.info(slot), finalized: true } : this.notFound(subUrl);
    }

    throw new Error(`Fixture has no route for [${subUrl}]`);
  }

  public countRequestsFor(blockId: number | string): number {
    return this.requestedSubUrls.filter((subUrl) => subUrl.endsWith(`/${blockId}`)).length;
  }

  private slotOf(blockId: string): number {
    return blockId.startsWith('0x') ? this.slotByRoot.get(blockId) ?? -1 : Number(blockId);
  }

  private notFound(subUrl: string): never {
    throw new ResponseError(`Not found: ${subUrl}`, 404);
  }
}

class TestConsensusProviderService extends ConsensusProviderService {
  protected async apiGet<T>(apiURL: string, subUrl: string): Promise<T> {
    return this.fixture.resolve(subUrl) as T;
  }

  public constructor(private readonly fixture: ChainFixture, gloasForkEpoch: number, cache: BlockCacheService, executionProvider: any) {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    super(logger as any, config as any, {} as any, cache, storage as any, executionProvider);

    this.genesisTime = GENESIS_TIME;
    this.forkEpochs = { deneb: 0, electra: 0, gloas: gloasForkEpoch };
  }

  public get logged(): { log: jest.Mock; warn: jest.Mock } {
    return (this as any).logger;
  }
}

const configValues: Record<string, any> = {
  CL_API_URLS: ['http://localhost:5052'],
  WORKING_MODE: 'finalized',
  CL_API_MAX_SLOT_DEEP_COUNT: 32,
  CL_API_MAX_RETRIES: 1,
  CL_API_GET_BLOCK_INFO_MAX_RETRIES: 1,
  CL_API_RETRY_DELAY_MS: 0,
  FETCH_INTERVAL_SLOTS: SLOTS_PER_EPOCH,
};

const config = { get: (key: string) => configValues[key] };
const storage = { getLastNotMissedSlotForEpoch: jest.fn() };

// Duty dependent root of epoch 4 is the last not missed slot at or before slot 127
const TARGET_EPOCH = 4;

const build = (blocks: ProposedBlock[], fork: 'fulu' | 'gloas', lastNotMissedSlot: number) => {
  const fixture = new ChainFixture(blocks, fork);
  const cache = new BlockCacheService({ debug: jest.fn() } as any, config as any);
  const executionProvider = {
    getBlockTimestamp: jest.fn(async (blockNumber: number) => fixture.executionTimestamps.get(blockNumber)),
    getBlockNumberByHash: jest.fn(async (hash: string) =>
      Number([...fixture.executionTimestamps.keys()].find((n) => executionBlockHash(n) === hash)),
    ),
  };

  storage.getLastNotMissedSlotForEpoch.mockResolvedValue({ slot: lastNotMissedSlot });
  const service = new TestConsensusProviderService(fixture, fork === 'gloas' ? 0 : Number.MAX_SAFE_INTEGER, cache, executionProvider);

  return { fixture, cache, executionProvider, service };
};

describe('ConsensusProviderService sparse network walk', () => {
  it('jumps to the next proposed slot by the execution layer block of the payload up to Fulu', async () => {
    const { cache, executionProvider, service } = build(
      [
        { slot: 110, executionBlockNumber: 999 },
        { slot: 120, executionBlockNumber: 1000 },
        { slot: 130, executionBlockNumber: 1001 },
      ],
      'fulu',
      120,
    );

    const root = await service.getDutyDependentRoot(TARGET_EPOCH, true);

    expect(root).toBe(blockRoot(120));
    // The payload is inline, so the walk needs no lookup by hash and one timestamp per hop
    expect(executionProvider.getBlockNumberByHash).not.toHaveBeenCalled();
    expect(executionProvider.getBlockTimestamp).toHaveBeenCalledTimes(1);
    expect(executionProvider.getBlockTimestamp).toHaveBeenCalledWith(1001);
    expect(cache.get(125).missed).toBe(true);
    expect(cache.get(129).missed).toBe(true);
  });

  it('anchors on the payload the state already has since Gloas, where the block carries only a bid', async () => {
    const { cache, executionProvider, service } = build(
      [
        { slot: 110, executionBlockNumber: 999 },
        { slot: 120, executionBlockNumber: 1000 },
        { slot: 130, executionBlockNumber: 1001 },
      ],
      'gloas',
      120,
    );

    const root = await service.getDutyDependentRoot(TARGET_EPOCH, true);

    expect(root).toBe(blockRoot(120));
    // `parent_block_hash` of the bid at slot 120 is the payload of slot 110, so the walk has to step over the payload
    // of slot 120 itself before it reaches the next proposed slot
    expect(executionProvider.getBlockNumberByHash).toHaveBeenCalledWith(executionBlockHash(999));
    expect(executionProvider.getBlockTimestamp.mock.calls.map(([n]) => n)).toEqual([1000, 1001]);
    expect(cache.get(125).missed).toBe(true);
  });

  it('does not report a Gloas block whose payload was not applied as missed', async () => {
    const { cache, service } = build(
      [
        { slot: 110, executionBlockNumber: 999 },
        { slot: 120, executionBlockNumber: 1000 },
        { slot: 125 },
        { slot: 130, executionBlockNumber: 1001 },
      ],
      'gloas',
      120,
    );

    const root = await service.getDutyDependentRoot(TARGET_EPOCH, true);

    expect(root).toBe(blockRoot(120));
    // Slot 125 has no execution layer block, so the walk jumped over it: it is proposed all the same
    expect(cache.get(125).missed).toBe(false);
    expect(cache.get(125).header.root).toBe(blockRoot(125));
    expect(cache.get(124).missed).toBe(true);
    expect(cache.get(126).missed).toBe(true);
  });

  it('serves the header of a skipped over Gloas block from the cache', async () => {
    const { fixture, service } = build(
      [
        { slot: 110, executionBlockNumber: 999 },
        { slot: 120, executionBlockNumber: 1000 },
        { slot: 125 },
        { slot: 130, executionBlockNumber: 1001 },
      ],
      'gloas',
      120,
    );

    await service.getDutyDependentRoot(TARGET_EPOCH, true);
    const header = await service.getBlockHeader(125);

    expect(header.header.message.slot).toBe('125');
    // Read back by root while walking `parent_root`, never asked for by slot
    expect(fixture.countRequestsFor(125)).toBe(0);
    expect(fixture.countRequestsFor(blockRoot(125))).toBe(1);
  });

  it('falls back to the dense algorithm when the block carries neither a payload nor a bid', async () => {
    const { executionProvider, service } = build(
      [
        { slot: 110, executionBlockNumber: 999 },
        { slot: 120, executionBlockNumber: 1000 },
        { slot: 130, executionBlockNumber: 1001 },
      ],
      'gloas',
      120,
    );
    // A shape the app does not understand: no payload inline and no bid to anchor on either
    jest.spyOn(service as any, 'getBlockInfo').mockResolvedValue({ message: { slot: '120', body: {} } });

    const root = await service.getDutyDependentRoot(TARGET_EPOCH, true);

    expect(root).toBe(blockRoot(120));
    expect(executionProvider.getBlockTimestamp).not.toHaveBeenCalled();
    expect(service.logged.warn).toHaveBeenCalledWith(expect.stringContaining('neither an execution payload nor a payload bid'));
  });

  it('falls back to the dense algorithm when an execution layer timestamp misses a slot boundary', async () => {
    const { fixture, service } = build(
      [
        { slot: 110, executionBlockNumber: 999 },
        { slot: 120, executionBlockNumber: 1000 },
        { slot: 130, executionBlockNumber: 1001 },
      ],
      'fulu',
      120,
    );
    fixture.executionTimestamps.set(1001, slotTime(130) + 5);

    const root = await service.getDutyDependentRoot(TARGET_EPOCH, true);

    expect(root).toBe(blockRoot(120));
    expect(service.logged.warn).toHaveBeenCalledWith(expect.stringContaining('does not fall on a slot boundary'));
  });
});

describe('ConsensusProviderService fork epochs', () => {
  class SpecOnlyConsensusProviderService extends ConsensusProviderService {
    protected async apiGet<T>(): Promise<T> {
      return { data: this.spec } as T;
    }

    public constructor(private readonly spec: Record<string, string>) {
      const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      super(logger as any, config as any, {} as any, {} as any, {} as any, {} as any);
    }
  }

  it('reads the Gloas fork epoch from the spec', async () => {
    const service = new SpecOnlyConsensusProviderService({ DENEB_FORK_EPOCH: '1', ELECTRA_FORK_EPOCH: '2', GLOAS_FORK_EPOCH: '3' });

    expect(await service.getForkEpochs()).toEqual({ deneb: 1, electra: 2, gloas: 3 });
  });

  it('keeps the Gloas fork out of reach on a chain that does not schedule it', async () => {
    const service = new SpecOnlyConsensusProviderService({ DENEB_FORK_EPOCH: '1', ELECTRA_FORK_EPOCH: '2' });

    expect((await service.getForkEpochs()).gloas).toBe(Number.MAX_SAFE_INTEGER);
  });
});
