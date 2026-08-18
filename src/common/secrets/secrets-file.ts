/**
 * Secrets that arrive as a file, and how a rotation is noticed.
 *
 * The EL and CL endpoints carry provider credentials, so in Kubernetes they are delivered by the
 * OpenBao agent as a JSON file rather than as environment variables. The reason is not aesthetics:
 * a process cannot be handed new environment variables from outside, so any env-based delivery
 * costs a pod restart per rotation, and until that restart happens the old credential keeps
 * working — which means a rotation nobody noticed looks exactly like a healthy deployment right up
 * to the moment the provider revokes the old key.
 *
 * The agent updates the file by writing a temp file and renaming it over the path. The rename is
 * atomic, so a reader never sees half a file — but it also creates a new inode, which is why this
 * polls the path with stat() instead of watching the file. A watcher attached to the file itself
 * (fs.watch, chokidar) goes silent after the first rotation.
 *
 * When the file is absent everything falls back to environment variables, which is how the compose
 * deployment on the VMs runs. The contract is deliberately the same as ethereum-head-watcher's
 * src/secrets.py, so that one description covers both services.
 */
import { readFileSync, statSync } from 'fs';

export const DEFAULT_SECRETS_FILE_PATH = '/vault/secrets/config';
export const DEFAULT_SECRETS_POLL_INTERVAL_IN_SECONDS = 10;

/**
 * The file's contents, or an empty object if there is no usable file.
 *
 * Absent is a normal state — it means "no agent here, use the environment". Present but unparseable
 * is not, so it is reported through onError and then treated the same way: refusing to start would
 * turn a bad render of one key into an outage of the whole indexer.
 */
export function readSecretsFile(path: string, onError?: (message: string) => void): Record<string, string> {
  if (!path) return {};

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      onError?.(`Can not read secrets file ${path}: ${String(error)}`);
    }
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    onError?.(`Secrets file ${path} is not valid JSON, ignoring it: ${String(error)}`);
    return {};
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    onError?.(`Secrets file ${path} is not a JSON object, ignoring it`);
    return {};
  }

  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]));
}

/** The path's mtime in milliseconds, or null when there is nothing at the path. */
export function readSecretsFileMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export type SecretsWatcherOptions = {
  path: string;
  intervalInSeconds: number;
  onChange: (values: Record<string, string>) => void;
  onError?: (message: string) => void;
};

/** Re-reads the secrets file when its mtime changes and hands the new values to a callback. */
export class SecretsWatcher {
  private mtime: number | null;
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(private readonly options: SecretsWatcherOptions) {
    this.mtime = readSecretsFileMtime(options.path);
  }

  /**
   * True if a change was seen and applied. Kept separate from the timer so the behaviour is
   * testable without waiting on an interval.
   */
  public checkOnce(): boolean {
    const mtime = readSecretsFileMtime(this.options.path);
    if (mtime === null || mtime === this.mtime) return false;

    const values = readSecretsFile(this.options.path, this.options.onError);
    if (Object.keys(values).length === 0) {
      // A rotation that renders to nothing is not something to apply over working values. The
      // mtime is remembered anyway: otherwise one broken render would report the same error every
      // poll interval, forever.
      this.mtime = mtime;
      this.options.onError?.(`Secrets file ${this.options.path} changed but has no usable values, keeping the previous ones`);
      return false;
    }

    try {
      this.options.onChange(values);
    } catch (error) {
      this.mtime = mtime;
      this.options.onError?.(`Can not apply rotated secrets, keeping the previous ones: ${String(error)}`);
      return false;
    }

    this.mtime = mtime;
    return true;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkOnce(), this.options.intervalInSeconds * 1000);
    // The poll must not be what keeps the process alive: with a referenced timer, an otherwise
    // finished process would sit in the event loop until the kubelet's grace period ran out.
    this.timer.unref?.();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
