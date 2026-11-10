import { json } from '@lido-nestjs/logger';

import { plainContext } from './plain-context.format';

const MESSAGE = Symbol.for('message');
const LEVEL = Symbol.for('level');

const render = (meta: Record<string, unknown>, secrets: string[] = []): string => {
  const info = { level: 'info', message: 'event', ...meta, [LEVEL]: 'info' };
  const out = json({ secrets }).transform(plainContext.transform(info), {}) as unknown as Record<symbol, string>;
  return out[MESSAGE];
};

describe('plainContext', () => {
  it('drops non-enumerable own properties, as an ORM entity keeps its manager there', () => {
    const entity = { id: 1, name: 'module' };
    Object.defineProperty(entity, '__helper', { value: { em: { password: 'x' } }, enumerable: false });

    expect(JSON.parse(render({ entity }))).toMatchObject({ entity: { id: 1, name: 'module' } });
    expect(render({ entity })).not.toContain('__helper');
  });

  it('uses toJSON, so a Date is a timestamp and not {}', () => {
    expect(JSON.parse(render({ at: new Date(0) })).at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('keeps the message and stack of an Error', () => {
    const output = render({ error: new Error('boom') });

    expect(output).toContain('boom');
    expect(output).toContain('Error: boom');
  });

  it('still masks secrets', () => {
    const output = render({ url: 'https://rpc.example/key-12345' }, ['key-12345']);

    expect(output).not.toContain('key-12345');
    expect(output).toContain('rpc.example');
  });

  it('replaces a cycle instead of recursing', () => {
    const node: Record<string, unknown> = { id: 1 };
    node.self = node;

    expect(JSON.parse(render({ node })).node.self).toBe('[Cycle]');
  });
});
