// The secret mask also copies non-enumerable own properties and skips toJSON: a MikroORM 6
// entity printed its EntityManager (~145 KB a line) and a Date printed as {}. Values reach the
// mask as JSON.stringify would see them; Errors pass through for their message and stack.

const MAX_DEPTH = 10;
const LEVEL = Symbol.for('level');

const toPlain = (value: unknown, ancestors: Set<object>, depth: number): unknown => {
  if (value === null || typeof value !== 'object' || value instanceof Error) return value;
  if (ancestors.has(value)) return '[Cycle]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => toPlain(item, ancestors, depth + 1));

    const { toJSON } = value as { toJSON?: unknown };
    if (typeof toJSON === 'function') return toPlain(toJSON.call(value), ancestors, depth + 1);

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = toPlain((value as Record<string, unknown>)[key], ancestors, depth + 1);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
};

export const plainContext = {
  transform: <T extends object>(info: T): T => {
    const target = info as Record<string | symbol, unknown>;
    for (const key of Object.keys(target)) {
      if (key !== 'level') target[key] = toPlain(target[key], new Set(), 0);
    }
    // The extra arguments of a log call stay under the splat symbol and are masked too
    for (const key of Object.getOwnPropertySymbols(target)) {
      if (key !== LEVEL) target[key] = toPlain(target[key], new Set(), 0);
    }
    return info;
  },
};
