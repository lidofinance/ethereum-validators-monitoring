import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/consensus-provider';
import { PrometheusService } from 'common/prometheus';

import { DEFAULT_SECRETS_POLL_INTERVAL_IN_SECONDS, SecretsWatcher, readSecretsFile } from './secrets-file';

export enum SecretsReloadStatus {
  Success = 'success',
  Failure = 'failure',
  /**
   * A value changed that this process cannot swap while running. Counted separately from a failure
   * on purpose: the rotation itself worked, and what is left is a restart someone has to do. Left
   * uncounted it would be the quietest of the three outcomes and the only one that eventually
   * breaks the indexer.
   */
  RestartRequired = 'restart_required',
}

/**
 * Which keys this process can re-point without restarting.
 *
 * CL_API_URLS can: ConsensusProviderService walks the list on every request, so replacing its
 * contents takes effect from the next one.
 *
 * EL_RPC_URLS cannot, and the reason is worth stating so nobody assumes it was an oversight. The
 * fallback list lives inside SimpleFallbackJsonRpcBatchProvider from @lido-nestjs/execution, where
 * it is protected and built once by the module factory, and the registry contracts hold that
 * instance for the lifetime of the process. Re-pointing it means rebuilding the provider and every
 * contract wired to it — a change to the DI graph rather than to this file, and a much larger one
 * than what a rotation is worth here: unlike the head watcher, whose restart costs minutes of
 * re-reading the validator set and every Lido key, this indexer loses one cycle.
 *
 * DB_PASSWORD cannot either. Several consumers hold a ClickHouse connection built from it, and
 * "pick it up without a restart" there means also not diverging between them.
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
      // Said out loud on both paths: "which of the two configuration sources is this process
      // running on" is the first question a rotation that did not arrive raises, and answering it
      // from the outside means reading the pod spec and guessing.
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
   * Apply what can be applied, and say plainly what cannot.
   *
   * Keys absent from the new file are not treated as removals: the agent renders the whole secret
   * every time, so a missing key is a bad render rather than an instruction to unset a working
   * endpoint.
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
      // Not applied, and not recorded as applied either — so the next poll reports it again, and
      // the counter keeps climbing for as long as the process runs on a credential the file no
      // longer holds. That is the intended shape: it is the only signal that a restart is owed.
      this.logger.warn(`Rotated secrets that need a restart to take effect: ${needsRestart.join(', ')}`);
      this.prometheus.secretsReloads.inc({ status: SecretsReloadStatus.RestartRequired });
    }
  }
}
