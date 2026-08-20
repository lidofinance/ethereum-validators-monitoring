/**
 * Secrets that arrive as a file, and how a change to it is noticed.
 *
 * The endpoints carry provider credentials and are delivered as a JSON file, because a process
 * cannot be handed new environment variables from outside: env-based delivery costs a restart per
 * rotation. The file is replaced by a rename, which gives it a new inode, so this polls the path
 * with stat() rather than watching the file.
 *
 * No file means the values come from the environment.
 */
import { readFileSync, statSync } from 'fs';

export const DEFAULT_SECRETS_FILE_PATH = '/vault/secrets/config';
export const DEFAULT_SECRETS_POLL_INTERVAL_IN_SECONDS = 10;

/**
 * The file's contents, or an empty object if there is no usable file.
 *
 * Absent is normal and means "use the environment". Unparseable is reported and treated the same
 * way, so one bad value cannot keep the indexer from starting.
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

  /** True if a change was seen and applied. Separate from the timer so it is testable. */
  public checkOnce(): boolean {
    const mtime = readSecretsFileMtime(this.options.path);
    if (mtime === null || mtime === this.mtime) return false;

    const values = readSecretsFile(this.options.path, this.options.onError);
    if (Object.keys(values).length === 0) {
      // Nothing usable: keep the values already in force. The mtime is remembered anyway, so a
      // broken file is reported once rather than every interval.
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
    // Unreferenced, so the poll never keeps a finished process alive.
    this.timer.unref?.();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
