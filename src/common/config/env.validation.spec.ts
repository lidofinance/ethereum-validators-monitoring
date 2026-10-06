import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  EnvironmentVariables,
  SECRET_KEYS,
  URL_KEYS,
  VALIDATOR_OPTIONS,
  bootstrapLogger,
  loggableConfig,
  validate,
} from './env.validation';
import { captureLogOutput } from '../../../test/capture-log-output';

describe('config transforms', () => {
  const CREDENTIALED_URL = 'https://user:s3cr3t@alertmanager.example.com/api';

  test.each([
    'CRITICAL_ALERTS_MIN_ACTIVE_VAL_COUNT',
    'CRITICAL_ALERTS_MIN_AFFECTED_VAL_COUNT',
    'CRITICAL_ALERTS_MIN_ACTIVE_VAL_BALANCE',
    'CRITICAL_ALERTS_MIN_AFFECTED_VAL_BALANCE',
    'CRITICAL_ALERTS_ALERTMANAGER_LABELS',
  ])('%s that is not JSON is reported by key, without the value', (key) => {
    // JSON.parse quotes the first ten characters of its input, which for a misplaced endpoint is
    // enough to confirm the credential's shape and host.
    expect(() => plainToInstance(EnvironmentVariables, { [key]: CREDENTIALED_URL })).toThrow(`${key} is not valid JSON`);

    try {
      plainToInstance(EnvironmentVariables, { [key]: CREDENTIALED_URL });
    } catch (error: any) {
      expect(error.message).not.toContain('https');
    }
  });

  test.each(['EL_RPC_URLS', 'CL_API_URLS', 'VALIDATOR_REGISTRY_KEYSAPI_SOURCE_URLS'])(
    '%s that is not a string is reported by key, without the value',
    (key) => {
      expect(() => plainToInstance(EnvironmentVariables, { [key]: 12345 })).toThrow(`${key} must be a comma-separated string`);
    },
  );

  test('validation errors carry neither the offending value nor the whole configuration', () => {
    const config = plainToInstance(EnvironmentVariables, { NODE_ENV: 'test', HTTP_PORT: '1024' });

    const serialised = JSON.stringify(validateSync(config, VALIDATOR_OPTIONS));

    expect(serialised).toContain('HTTP_PORT');
    expect(serialised).not.toContain('1024');
    expect(serialised).not.toContain('target');
  });
});

describe('loggable configuration', () => {
  const CREDENTIAL = 'hunter2';
  const values: Record<string, unknown> = {
    DB_PASSWORD: CREDENTIAL,
    EL_RPC_URLS: ['https://user:key@rpc.example.com/v2/deadbeef?apikey=k'],
    CL_API_URLS: ['http://cl:5052'],
    VALIDATOR_REGISTRY_KEYSAPI_SOURCE_URLS: ['not a url at all'],
    CRITICAL_ALERTS_ALERTMANAGER_URL: '',
  };

  const defaults = new EnvironmentVariables() as Record<string, any>;
  const dump = () => loggableConfig((key) => (key in values ? values[key] : defaults[key]));

  test('the dump lists every field, not a selection', () => {
    // Enumeration relies on useDefineForClassFields, so the `DB_HOST!: string` fields are present
    // on a fresh instance. A change of tsconfig target is what this notices.
    expect(Object.keys(dump())).toEqual(Object.keys(defaults));
    expect(dump()).toHaveProperty('DB_HOST');
    expect(Object.keys(dump()).length).toBeGreaterThan(40);
  });

  test('secrets are masked and endpoints are cut to scheme and host', () => {
    expect(dump().DB_PASSWORD).toBe('<masked>');
    expect(dump().EL_RPC_URLS).toEqual(['https://rpc.example.com']);
    expect(dump().CL_API_URLS).toEqual(['http://cl:5052']);
    expect(dump().VALIDATOR_REGISTRY_KEYSAPI_SOURCE_URLS).toEqual(['<unparseable>']);
  });

  test('an unset secret stays empty, because "not set" is the diagnosis', () => {
    expect(dump().CRITICAL_ALERTS_ALERTMANAGER_URL).toBe('');
    expect(loggableConfig((key) => (key === 'DB_PASSWORD' ? '' : defaults[key])).DB_PASSWORD).toBe('');
  });

  test('every declared secret key is masked or reduced in the dump', () => {
    const serialised = JSON.stringify(dump());

    expect(serialised).not.toContain(CREDENTIAL);
    expect(serialised).not.toContain('deadbeef');
    [...SECRET_KEYS, ...URL_KEYS].forEach((key) => expect(Object.keys(dump())).toContain(key));
  });

  test('infrastructure identifiers stay visible', () => {
    expect([...SECRET_KEYS, ...URL_KEYS]).not.toContain('DB_USER');
    expect([...SECRET_KEYS, ...URL_KEYS]).not.toContain('DB_HOST');
  });
});

describe('validate', () => {
  let captured: ReturnType<typeof captureLogOutput>;
  let exit: jest.SpyInstance;

  beforeEach(() => {
    captured = captureLogOutput();
    exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as any);
  });

  afterEach(() => {
    captured.restore();
    exit.mockRestore();
  });

  test('a transform failure is reported as JSON, by key, and ends the process', () => {
    expect(() => validate({ NODE_ENV: 'test', CRITICAL_ALERTS_ALERTMANAGER_LABELS: 'not json' })).toThrow('exit 1');

    const line = JSON.parse(captured.output());
    expect(line.level).toBe('error');
    expect(line.message).toContain('CRITICAL_ALERTS_ALERTMANAGER_LABELS is not valid JSON');
  });

  test('a validation failure is reported as JSON and ends the process', () => {
    expect(() => validate({ NODE_ENV: 'test', HTTP_PORT: '1024' })).toThrow('exit 1');

    const line = JSON.parse(captured.output());
    expect(line.message).toContain('HTTP_PORT');
  });

  test('the secret values it saw are redacted in whatever the startup reports later', () => {
    const credential = 'hunter2';
    validate({ NODE_ENV: 'test', ETH_NETWORK: '1', DB_PASSWORD: credential });

    bootstrapLogger().error('Startup failed', `Error: connect ECONNREFUSED, ${credential}`);

    expect(captured.output()).not.toContain(credential);
    expect(captured.output()).toContain('<removed>');
  });
});
