interface TtlOptions {
  /** Serve the expired cached value when a refresh fails, instead of throwing. */
  staleOnError?: boolean;
}

export function ttlCacheBy<K, V>(
  ttlMs: number,
  load: (key: K) => Promise<V>,
  opts: TtlOptions = {}
): (key: K) => Promise<V> {
  const cache = new Map<K, { value: V; at: number }>();
  const inflight = new Map<K, Promise<V>>();
  return async (key: K): Promise<V> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at <= ttlMs) return hit.value;
    // Coalesce concurrent misses onto one request: the first caller starts the
    // load, the rest await the same promise instead of firing duplicate fetches.
    const pending = inflight.get(key);
    if (pending) return pending;
    const load$ = (async () => {
      try {
        const value = await load(key);
        cache.set(key, { value, at: Date.now() });
        return value;
      } catch (e) {
        if (opts.staleOnError && hit) return hit.value;
        throw e;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, load$);
    return load$;
  };
}

export function ttlCache<V>(ttlMs: number, load: () => Promise<V>, opts: TtlOptions = {}): () => Promise<V> {
  const byKey = ttlCacheBy<null, V>(ttlMs, load, opts);
  return () => byKey(null);
}
