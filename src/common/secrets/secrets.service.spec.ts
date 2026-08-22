import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SecretsReloadStatus, SecretsService } from './secrets.service';

/** Records the restart instead of signalling the test runner's own process. */
class TestSecretsService extends SecretsService {
  public restarts = 0;

  protected requestRestart(): void {
    this.restarts += 1;
  }
}

describe('SecretsService', () => {
  let dir: string;
  let path: string;
  let service: TestSecretsService;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let prometheus: { secretsReloads: { inc: jest.Mock }; secretsFileMtime: { set: jest.Mock } };

  const write = (values: Record<string, string>) => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(values));
    renameSync(tmp, path);
  };

  const build = (secretsPath: string) => {
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    prometheus = { secretsReloads: { inc: jest.fn() }, secretsFileMtime: { set: jest.fn() } };
    const config = {
      get: (key: string) => (key === 'SECRETS_FILE_PATH' ? secretsPath : 10),
    };
    return new TestSecretsService(logger as any, config as any, prometheus as any);
  };

  const apply = (values: Record<string, string>) => (service as any).apply(values);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'evm-secrets-service-'));
    path = join(dir, 'config');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports the file it read as the mtime a scrape can see', () => {
    write({ CL_API_URLS: 'http://cl:5052' });
    service = build(path);
    service.onModuleInit();

    expect(prometheus.secretsFileMtime.set).toHaveBeenCalledWith(expect.any(Number));
    expect(prometheus.secretsFileMtime.set.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('reports mtime 0 when there is no file, so the environment path is not read as a stale file', () => {
    service = build(join(dir, 'nothing-here'));
    service.onModuleInit();

    expect(prometheus.secretsFileMtime.set).toHaveBeenCalledWith(0);
    service.onApplicationShutdown();
    expect(service.restarts).toBe(0);
  });

  it('does not restart when the file is re-rendered with the values already in force', () => {
    write({ CL_API_URLS: 'http://cl:5052' });
    service = build(path);
    service.onModuleInit();

    apply({ CL_API_URLS: 'http://cl:5052' });

    expect(service.restarts).toBe(0);
    expect(prometheus.secretsReloads.inc).not.toHaveBeenCalled();
  });

  it('restarts on a rotated value, and once — a second change while stopping is not a second signal', () => {
    write({ CL_API_URLS: 'http://cl:5052' });
    service = build(path);
    service.onModuleInit();

    apply({ CL_API_URLS: 'http://cl-new:5052' });
    apply({ CL_API_URLS: 'http://cl-newer:5052' });

    expect(service.restarts).toBe(1);
    expect(prometheus.secretsReloads.inc).toHaveBeenCalledTimes(1);
    expect(prometheus.secretsReloads.inc).toHaveBeenCalledWith({ status: SecretsReloadStatus.Restart });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CL_API_URLS'));
  });

  it('restarts on a key the environment supplied and the file did not, since the file wins at startup', () => {
    write({ CL_API_URLS: 'http://cl:5052' });
    service = build(path);
    service.onModuleInit();

    apply({ CL_API_URLS: 'http://cl:5052', DB_PASSWORD: 'rotated' });

    expect(service.restarts).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('DB_PASSWORD'));
  });

  it('forces the exit when the graceful shutdown does not finish, since nothing else bounds a self-restart', () => {
    jest.useFakeTimers();
    // The real requestRestart is what is under test, so the signal and the exit it ends in are the
    // things stubbed — for the whole test, since the exit happens on a timer.
    const kill = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    try {
      write({ CL_API_URLS: 'http://cl:5052' });
      logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      prometheus = { secretsReloads: { inc: jest.fn() }, secretsFileMtime: { set: jest.fn() } };
      const config = {
        get: (key: string) => (key === 'SECRETS_FILE_PATH' ? path : key === 'SHUTDOWN_TIMEOUT_IN_SECONDS' ? 25 : 10),
      };
      const service = new SecretsService(logger as any, config as any, prometheus as any);
      service.onModuleInit();

      (service as any).apply({ CL_API_URLS: 'http://cl-new:5052' });

      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(exit).not.toHaveBeenCalled();

      // The graceful path had its budget and a margin on top; after that the restart is not optional.
      jest.advanceTimersByTime(30_000);

      expect(exit).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Shutdown did not finish'));
    } finally {
      jest.useRealTimers();
      kill.mockRestore();
      exit.mockRestore();
    }
  });
});
