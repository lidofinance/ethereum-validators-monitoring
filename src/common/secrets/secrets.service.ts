import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { PrometheusService } from 'common/prometheus';

import { DEFAULT_SECRETS_POLL_INTERVAL_IN_SECONDS, SecretsWatcher, changedKeys, readSecretsFile } from './secrets-file';

export enum SecretsReloadStatus {
  /** A rotation was seen and a restart was asked for. */
  Restart = 'restart',
  /** The file changed but could not be used, so the values in force were kept. */
  Failure = 'failure',
}

/**
 * Watches the secrets file and restarts the process when its values change.
 *
 * There is deliberately no live-apply path. Startup already prefers the file over the environment,
 * so a restart re-reads every key, including ones added later — correctness does not depend on a
 * per-key list being kept up to date. Re-pointing a single key in place would only be provably
 * enough while the module holding it keeps walking its own list per call, which is a detail of
 * another module that can change without anything here noticing.
 *
 * The cost is bounded: processed epochs are persisted, so a restart resumes from the last one and
 * redoes at most the epoch in flight.
 */
@Injectable()
export class SecretsService implements OnModuleInit, OnApplicationShutdown {
  private watcher: SecretsWatcher | null = null;
  private applied: Record<string, string> = {};
  private restarting = false;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
  ) {}

  public onModuleInit(): void {
    const path = this.config.get('SECRETS_FILE_PATH');
    this.applied = readSecretsFile(path, (message) => this.logger.error(message));

    if (Object.keys(this.applied).length === 0) {
      // Logged on both paths, so which source is in use is answerable from the log alone.
      this.logger.log(`Configuration: the environment (no secrets file at ${path})`);
      return;
    }

    this.logger.log(`Configuration: ${path} over the environment`);

    this.watcher = new SecretsWatcher({
      path,
      intervalInSeconds: this.config.get('SECRETS_POLL_INTERVAL_IN_SECONDS') ?? DEFAULT_SECRETS_POLL_INTERVAL_IN_SECONDS,
      onChange: (values) => this.apply(values),
      onError: (message) => {
        this.logger.error(message);
        this.prometheus.secretsReloads.inc({ status: SecretsReloadStatus.Failure });
      },
    });
    this.watcher.start();
  }

  public onApplicationShutdown(): void {
    this.watcher?.stop();
  }

  /** Restart if any value differs from the one in force. The comparison is in changedKeys. */
  private apply(values: Record<string, string>): void {
    const changed = changedKeys(this.applied, values);
    if (changed.length === 0 || this.restarting) return;

    this.restarting = true;
    this.watcher?.stop();

    this.logger.warn(`Rotated secrets, restarting to pick them up: ${changed.join(', ')}`);
    this.prometheus.secretsReloads.inc({ status: SecretsReloadStatus.Restart });

    this.requestRestart();
  }

  /**
   * Signals ourselves rather than calling exit, so the shutdown runs the same lifecycle hooks a
   * pod deletion would — the inspector finishes its cycle instead of being cut mid-write.
   *
   * Overridable so the decision to restart can be tested without ending the test process.
   */
  protected requestRestart(): void {
    process.kill(process.pid, 'SIGTERM');
  }
}
