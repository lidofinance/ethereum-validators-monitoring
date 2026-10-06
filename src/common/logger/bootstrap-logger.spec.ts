import { LogFormat } from 'common/config/interfaces';

import { createBootstrapLogger } from './bootstrap-logger';
import { captureLogOutput } from '../../../test/capture-log-output';

describe('bootstrap logger', () => {
  const CREDENTIALED_URL = 'https://user:s3cr3t@cl.example.com/eth/v1';
  let captured: ReturnType<typeof captureLogOutput>;

  beforeEach(() => (captured = captureLogOutput()));
  afterEach(() => captured.restore());

  const output = () => captured.output();

  test('a secret is replaced in the message', () => {
    createBootstrapLogger(LogFormat.json, [CREDENTIALED_URL]).error(`Can not reach ${CREDENTIALED_URL}`);

    expect(output()).not.toContain('s3cr3t');
    expect(output()).toContain('<removed>');
    expect(JSON.parse(output())).toMatchObject({ level: 'error' });
  });

  test('a secret is replaced in the trace, which is how a startup failure reports one', () => {
    const error = new Error(`getaddrinfo ENOTFOUND ${CREDENTIALED_URL}`);

    createBootstrapLogger(LogFormat.json, [CREDENTIALED_URL]).error('Startup failed', error.stack);

    expect(output()).toContain('Startup failed');
    expect(output()).not.toContain('s3cr3t');
  });

  test('the simple format is not JSON, and an unknown format still logs as JSON', () => {
    createBootstrapLogger(LogFormat.simple, []).error('simple line');
    expect(() => JSON.parse(output())).toThrow();

    captured.restore();
    captured = captureLogOutput();
    createBootstrapLogger('yaml-perhaps', []).error('unknown format');
    expect(JSON.parse(output())).toMatchObject({ message: 'unknown format' });
  });

  test('it logs whatever LOG_LEVEL says, because it only reports failures', () => {
    // LOG_LEVEL=warning silences a winston logger completely — see winston-level.ts. The line this
    // logger exists to print is the last one the process emits, so it cannot be filtered.
    process.env.LOG_LEVEL = 'warning';

    createBootstrapLogger(LogFormat.json, []).error('still printed');

    expect(output()).toContain('still printed');
  });
});
