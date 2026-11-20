interface TtlOptions {
  /** Serve the expired cached value when a refresh fails, instead of throwing. */
  staleOnError?: boolean;
}

/** A cached loader that can also be told its data changed. */
export type Cached<A extends unknown[], V> = ((...args: A) => Promise<V>) & {
  /** Forget everything cached, including loads already under way. */
  clear(): void;
};

export function ttlCacheBy<K, V>(
  ttlMs: number,
  load: (key: K) => Promise<V>,
  opts: TtlOptions = {}
): Cached<[K], V> {
  const cache = new Map<K, { value: V; at: number }>();
  const inflight = new Map<K, Promise<V>>();
  // A load that started before clear() must not put what it read back into the cache.
  let generation = 0;
  const get = async (key: K): Promise<V> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at <= ttlMs) return hit.value;
    // Coalesce concurrent misses onto one request: the first caller starts the
    // load, the rest await the same promise instead of firing duplicate fetches.
    const pending = inflight.get(key);
    if (pending) return pending;
    const started = generation;
    const load$ = (async () => {
      try {
        const value = await load(key);
        if (started === generation) cache.set(key, { value, at: Date.now() });
        return value;
      } catch (e) {
        if (opts.staleOnError && hit) return hit.value;
        throw e;
      } finally {
        // after clear(), the entry may already belong to a newer load
        if (started === generation) inflight.delete(key);
      }
    })();
    inflight.set(key, load$);
    return load$;
  };
  return Object.assign(get, {
    clear: () => {
      generation++;
      cache.clear();
      inflight.clear();
    },
  });
}

export function ttlCache<V>(ttlMs: number, load: () => Promise<V>, opts: TtlOptions = {}): Cached<[], V> {
  const byKey = ttlCacheBy<null, V>(ttlMs, load, opts);
  return Object.assign(() => byKey(null), { clear: () => byKey.clear() });
}
