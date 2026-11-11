import { InspectorService } from './inspector.service';

/**
 * The loop body is replaced, because what is under test is the shutdown sequence around it: Nest
 * re-raises the signal as soon as its hooks return, so a flag nothing waits for buys nothing.
 */
class TestInspectorService extends InspectorService {
  public entered = false;
  public returned = false;

  public constructor(private readonly body: (stopping: () => boolean) => Promise<void>, shutdownTimeoutInSeconds = 1) {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const config = { get: (key: string) => (key === 'SHUTDOWN_TIMEOUT_IN_SECONDS' ? shutdownTimeoutInSeconds : undefined) };
    const unused = {} as any;
    super(logger as any, config as any, unused, unused, unused, unused, unused, unused, unused, unused);
  }

  public get logged(): { log: jest.Mock; warn: jest.Mock } {
    return (this as any).logger;
  }

  protected async runLoop(): Promise<void> {
    this.entered = true;
    await this.body(() => (this as any).stopping);
    this.returned = true;
  }
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('InspectorService shutdown', () => {
  it('waits for the loop to return before letting the process go', async () => {
    const service = new TestInspectorService(async (stopping) => {
      while (!stopping()) await tick(5);
    });
    service.startLoop();
    await tick(10);

    service.onModuleDestroy();
    await service.beforeApplicationShutdown();

    expect(service.returned).toBe(true);
    expect(service.logged.log).toHaveBeenCalledWith('Inspector loop stopped');
  });

  it('gives up at the deadline, so a loop stuck in a long epoch cannot hold the pod past its grace period', async () => {
    const service = new TestInspectorService(() => new Promise<void>(() => undefined), 0.05);
    service.startLoop();

    service.onModuleDestroy();
    await service.beforeApplicationShutdown();

    expect(service.returned).toBe(false);
    expect(service.logged.warn).toHaveBeenCalledWith(expect.stringContaining('did not stop within'));
  });

  it('returns at once when the loop never started', async () => {
    const service = new TestInspectorService(async () => undefined);

    service.onModuleDestroy();
    await service.beforeApplicationShutdown();

    expect(service.entered).toBe(false);
  });
});
