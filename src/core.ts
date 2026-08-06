/**
 * Library entry point — `import { createClient } from "atimelogger-mcp"`.
 *
 * EXPERIMENTAL while the package is 0.x: these signatures may change in a minor
 * release. Pin an exact version if you depend on them.
 *
 * This is the same task-shaped layer the MCP tools and the CLI are built on
 * (fuzzy type-name resolution, period words, DST-correct timezones, humanized
 * durations), exposed so a long-running process can call it in-process instead
 * of spawning a binary per request. `createClient` takes credentials explicitly
 * and never touches the environment; `clientFromEnv` is the opt-in ATL_TOKEN /
 * ATL_BASE_URL path.
 */
import { createApi, type Api, type ApiOptions, type FetchLike } from "./client.js";
import { loadConfig } from "./config.js";
import { createContext, type Ctx } from "./context.js";
import type { TypesCache } from "./types-cache.js";
import { currentStatus } from "./tools/activities.js";
import { listTypes } from "./tools/types.js";
import { timeReport, listIntervals, type ReportArgs } from "./tools/reports.js";

export { createApi, ApiError } from "./client.js";
export type { Api, ApiOptions, FetchLike } from "./client.js";
export { createContext } from "./context.js";
export type { Ctx } from "./context.js";
export type { ActivityTypeDto, ResolveOptions, TypesCache } from "./types-cache.js";
export type { ReportArgs } from "./tools/reports.js";
export { PERIOD_WORDS, resolveRange, rangeDays, unixToLocal, wallTimeToUtc } from "./periods.js";
export type { PeriodWord, DateRange } from "./periods.js";
export { formatDuration } from "./format.js";
export { UsageError } from "./errors.js";

/**
 * Read operations over one account, sharing an HTTP client and its caches.
 * Purely in-process — no daemon, no persisted state, no cross-process reuse.
 */
export interface AtlClient {
  /** Raw authenticated HTTP client — escape hatch for endpoints not wrapped here (writes). */
  api: Api;
  /** Fuzzy type-name resolution against this account's type list. */
  typeCache: TypesCache;
  status(timezone?: string): Promise<unknown>;
  types(includeArchived?: boolean): Promise<unknown>;
  report(args: ReportArgs & { group_by?: "DAY" | "WEEK" | "MONTH" }): Promise<unknown>;
  intervals(args: ReportArgs & { page?: number; size?: number }): Promise<unknown>;
}

export function createClient(options: ApiOptions): AtlClient {
  const ctx: Ctx = createContext(options);
  return {
    api: ctx.api,
    typeCache: ctx.types,
    status: async (timezone) => currentStatus(await ctx.timezone.effectiveTimezone(timezone), ctx),
    types: (includeArchived = false) => listTypes(includeArchived, ctx),
    report: (args) => timeReport(args, ctx),
    intervals: (args) => listIntervals(args, ctx),
  };
}

/**
 * Client configured from the environment (`ATL_TOKEN`, optional `ATL_BASE_URL`)
 * — the single-account case. Prefer this over hand-rolling
 * `createClient({ token: process.env.ATL_TOKEN })`, which would ignore
 * `ATL_BASE_URL` and silently target production.
 *
 * Throws if `ATL_TOKEN` is unset (unlike the MCP server and CLI, a library must
 * never exit the host process).
 */
export function clientFromEnv(overrides: { fetch?: FetchLike } = {}): AtlClient {
  if (!process.env.ATL_TOKEN) {
    throw new Error(
      "ATL_TOKEN is not set — set it, or pass a token explicitly with createClient({ token })."
    );
  }
  const config = loadConfig(); // resolves ATL_BASE_URL, warns if the token is not a PAT
  return createClient({ token: config.token, baseUrl: config.baseUrl, fetch: overrides.fetch });
}
