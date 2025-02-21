export function makeDefaultMap<TKey, TValue>(factory: (key: TKey) => TValue) {
  const cache = new Map<TKey, TValue>();

  return {
    getOrCreate: (key: TKey) => {
      let value = cache.get(key);
      if (value === undefined) {
        value = factory(key);
        cache.set(key, value);
      }

      return value;
    },
  };
}
