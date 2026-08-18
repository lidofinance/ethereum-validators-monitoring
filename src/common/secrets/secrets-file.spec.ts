import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SecretsWatcher, readSecretsFile } from './secrets-file';

describe('secrets file', () => {
  let dir: string;
  let path: string;

  const write = (contents: string) => {
    // The OpenBao agent renders to a temp file and renames it over the path, which is what makes
    // the update atomic and what gives the file a new inode every time. Reproduced here because
    // that new inode is the reason the watcher polls the path instead of watching the file.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, contents);
    renameSync(tmp, path);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'evm-secrets-'));
    path = join(dir, 'config');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('an absent file is a normal state and reads as no values', () => {
    const onError = jest.fn();
    expect(readSecretsFile(join(dir, 'nothing-here'), onError)).toEqual({});
    expect(onError).not.toHaveBeenCalled();
  });

  test('values are stringified, so a number in the secret does not reach a URL parser as a number', () => {
    write(JSON.stringify({ CL_API_URLS: 'http://cl:5052', CL_API_MAX_RETRIES: 3 }));
    expect(readSecretsFile(path)).toEqual({ CL_API_URLS: 'http://cl:5052', CL_API_MAX_RETRIES: '3' });
  });

  test.each([
    ['not JSON at all', 'nope'],
    ['a JSON array', '["http://cl:5052"]'],
    ['JSON null', 'null'],
  ])('%s is reported and ignored rather than applied', (_name, contents) => {
    write(contents);
    const onError = jest.fn();
    expect(readSecretsFile(path, onError)).toEqual({});
    expect(onError).toHaveBeenCalled();
  });

  test('a rename over the path is seen as a change', () => {
    write(JSON.stringify({ CL_API_URLS: 'http://one:5052' }));
    const onChange = jest.fn();
    const watcher = new SecretsWatcher({ path, intervalInSeconds: 10, onChange });

    expect(watcher.checkOnce()).toBe(false);

    write(JSON.stringify({ CL_API_URLS: 'http://two:5052' }));
    expect(watcher.checkOnce()).toBe(true);
    expect(onChange).toHaveBeenCalledWith({ CL_API_URLS: 'http://two:5052' });
  });

  test('a render with no usable values keeps the previous ones and does not report twice', () => {
    write(JSON.stringify({ CL_API_URLS: 'http://one:5052' }));
    const onChange = jest.fn();
    const onError = jest.fn();
    const watcher = new SecretsWatcher({ path, intervalInSeconds: 10, onChange, onError });

    write('');
    expect(watcher.checkOnce()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();

    // The mtime is remembered even for a bad render: otherwise one broken template would report
    // the same error every poll interval for as long as the process ran.
    onError.mockClear();
    expect(watcher.checkOnce()).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  test('a callback that throws leaves the previous values in place', () => {
    write(JSON.stringify({ CL_API_URLS: 'http://one:5052' }));
    const onError = jest.fn();
    const watcher = new SecretsWatcher({
      path,
      intervalInSeconds: 10,
      onChange: () => {
        throw new Error('cannot apply');
      },
      onError,
    });

    write(JSON.stringify({ CL_API_URLS: 'http://two:5052' }));
    expect(watcher.checkOnce()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('cannot apply'));
  });
});
