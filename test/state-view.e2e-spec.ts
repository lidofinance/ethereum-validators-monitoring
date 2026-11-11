import { ValStatus } from 'common/types/types';
import { StateService } from 'duty/state';
import { SummaryService } from 'duty/summary';

/**
 * Reading of a beacon state, put through the very ssz types the app reads in production.
 *
 * Up to Fulu the state keeps its lists as plain ones and since Gloas (EIP-7916) as progressive ones, which are
 * different classes with different trees, so both forks are put through the service here. It needs no node to run
 * against, unlike the rest of the suite, and it lives here because @lodestar/types is an ESM only package: reaching it
 * from a test needs the `--experimental-vm-modules` flag the e2e script already passes.
 */

const EPOCH = 4;
const STATE_SLOT = EPOCH * 32 + 31;

// The same hack the app uses to reach an ESM only package from a CommonJS build
const loadSsz = async (): Promise<any> => await eval(`import('@lodestar/types').then((m) => m.ssz)`);

const pubkeyOf = (fill: number) => '0x'.concat(Buffer.from(new Uint8Array(48).fill(fill)).toString('hex'));

const buildStateView = (ssz: any, fork: 'fulu' | 'gloas') => {
  const BeaconState = ssz[fork].BeaconState;
  const state = BeaconState.defaultValue();
  const validator = (fill: number, exitEpoch: number) => ({
    ...ssz.phase0.Validator.defaultValue(),
    pubkey: new Uint8Array(48).fill(fill),
    effectiveBalance: 32000000000,
    activationEligibilityEpoch: 0,
    activationEpoch: 0,
    exitEpoch,
    withdrawableEpoch: Infinity,
  });

  state.validators = [validator(1, Infinity), validator(2, EPOCH + 10)];
  state.balances = [32000000001, 32000000002];
  state.pendingConsolidations = [{ sourceIndex: 0, targetIndex: 1 }];

  return BeaconState.deserializeToView(BeaconState.serialize(state));
};

const build = (stateView: any) => {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const config = { get: (key: string) => (key === 'FETCH_INTERVAL_SLOTS' ? 32 : undefined) };
  const prometheus = { taskDuration: { startTimer: () => () => 0 }, taskCount: { inc: jest.fn() } };
  const clClient = { getSlotTime: jest.fn(async () => 1606824023), getState: jest.fn(async () => stateView) };
  const registry = {
    updateKeysRegistry: jest.fn(async () => undefined),
    getStuckKeys: jest.fn(() => []),
    getOperatorKey: jest.fn(() => undefined),
  };
  const summary = new SummaryService();
  const unused = {} as any;

  const service = new StateService(logger as any, config as any, prometheus as any, clClient as any, summary, unused, registry as any);

  return { service, summary };
};

describe('beacon state view', () => {
  let ssz: any;

  beforeAll(async () => {
    ssz = await loadSsz();
  });

  it.each(['fulu', 'gloas'] as const)('reads the validators, the balances and the consolidations of a %s state', async (fork) => {
    const { service, summary } = build(buildStateView(ssz, fork));

    await service.check(EPOCH, STATE_SLOT);

    const validators = [...summary.epoch(EPOCH).values()];
    expect(validators.map((v) => v.val_id)).toEqual([0, 1]);
    expect(validators.map((v) => v.val_pubkey)).toEqual([pubkeyOf(1), pubkeyOf(2)]);
    expect(validators.map((v) => v.val_balance)).toEqual([BigInt(32000000001), BigInt(32000000002)]);
    expect(validators.map((v) => v.val_effective_balance)).toEqual([BigInt(32000000000), BigInt(32000000000)]);
    // The second validator has an exit epoch set, which is what tells the two statuses apart
    expect(validators.map((v) => v.val_status)).toEqual([ValStatus.ActiveOngoing, ValStatus.ActiveExiting]);
    expect(summary.epoch(EPOCH).getMeta().state.active_validators).toBe(2);
    expect(summary.epoch(EPOCH).getPendingConsolidations()).toEqual([{ source_index: 0, target_index: 1 }]);
  });

  it.each(['fulu', 'gloas'] as const)('keeps `FAR_FUTURE_EPOCH` as Infinity when reading a %s state', async (fork) => {
    const view = buildStateView(ssz, fork);

    const [first] = view.validators.getAllReadonlyValues();

    expect(first.exitEpoch).toBe(Infinity);
    expect(first.withdrawableEpoch).toBe(Infinity);
  });
});
