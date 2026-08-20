import { api as envApi, createApi, type Api, type ApiOptions } from "./client.js";
import { createTypesCache, defaultTypesCache, type TypesCache } from "./types-cache.js";
import { createTimezone, defaultTimezone, type TimezoneResolver } from "./timezone.js";

/**
 * Everything a task-shaped operation needs: an API client plus the per-client
 * caches. Passing one explicitly lets several accounts (or a mocked transport)
 * coexist in one process; omitting it uses the environment-driven default.
 */
export interface Ctx {
  api: Api;
  types: TypesCache;
  timezone: TimezoneResolver;
}

export function createContext(options: ApiOptions): Ctx {
  const api = createApi(options);
  return { api, types: createTypesCache(api), timezone: createTimezone(api) };
}

let envCtx: Ctx | undefined;

/** Context over the env-driven client; the caches are shared process-wide. */
export function defaultContext(): Ctx {
  if (!envCtx) envCtx = { api: envApi, types: defaultTypesCache, timezone: defaultTimezone };
  return envCtx;
}
