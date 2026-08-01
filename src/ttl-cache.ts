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
  return async (key: K): Promise<V> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at <= ttlMs) return hit.value;
    let value: V;
    try {
      value = await load(key);
    } catch (e) {
      if (opts.staleOnError && hit) return hit.value;
      throw e;
    }
    cache.set(key, { value, at: Date.now() });
    return value;
  };
}

export function ttlCache<V>(ttlMs: number, load: () => Promise<V>, opts: TtlOptions = {}): () => Promise<V> {
  const byKey = ttlCacheBy<null, V>(ttlMs, load, opts);
  return () => byKey(null);
}
