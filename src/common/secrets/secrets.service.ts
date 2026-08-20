import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/consensus-provider';
import { PrometheusService } from 'common/prometheus';

import { DEFAULT_SECRETS_POLL_INTERVAL_IN_SECONDS, SecretsWatcher, readSecretsFile } from './secrets-file';

export enum SecretsReloadStatus {
  Success = 'success',
  Failure = 'failure',
  /** Changed, but not swappable while running: what is left is a restart. */
  RestartRequired = 'restart_required',
}

/**
 * Which keys this process can re-point without restarting.
 *
 * CL_API_URLS can: the consensus client walks its list per request, so replacing it is enough.
 * EL_RPC_URLS cannot — the fallback list is private to the provider and the contracts hold that
 * instance, so re-pointing means rebuilding both. Neither can DB_PASSWORD: several callers hold a
 * connection built from it.
 */
const LIVE_APPLICABLE_KEYS = ['CL_API_URLS'];

@Injectable()
export class SecretsService implements OnModuleInit, OnApplicationShutdown {
  private watcher: SecretsWatcher | null = null;
  private applied: Record<string, string> = {};

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
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

  /**
   * Apply what can be applied, and log what cannot.
   *
   * A key missing from the new file is a bad render, not an instruction to unset a working value,
   * so absences are ignored.
   */
  private apply(values: Record<string, string>): void {
    const changed = Object.keys(values).filter((key) => values[key] !== this.applied[key]);
    if (changed.length === 0) return;

    const live = changed.filter((key) => LIVE_APPLICABLE_KEYS.includes(key));
    const needsRestart = changed.filter((key) => !LIVE_APPLICABLE_KEYS.includes(key));

    if (live.includes('CL_API_URLS')) {
      const urls = values['CL_API_URLS']
        .split(',')
        .map((url) => url.trim())
        .filter((url) => url.length > 0);
      if (urls.length === 0) {
        throw new Error('CL_API_URLS in the secrets file has no usable URLs');
      }
      this.clClient.setApiUrls(urls);
    }

    for (const key of live) {
      this.applied[key] = values[key];
    }

    if (live.length > 0) {
      this.logger.log(`Applied rotated secrets: ${live.join(', ')}`);
      this.prometheus.secretsReloads.inc({ status: SecretsReloadStatus.Success });
    }

    if (needsRestart.length > 0) {
      // Not recorded as applied, so later rotations report it again until a restart happens.
      // Reported per rotation rather than per poll: alert on an increase, not on a level.
      this.logger.warn(`Rotated secrets that need a restart to take effect: ${needsRestart.join(', ')}`);
      this.prometheus.secretsReloads.inc({ status: SecretsReloadStatus.RestartRequired });
    }
  }
}
