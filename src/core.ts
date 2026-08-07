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
import { readEnvConfig } from "./config.js";
import { createContext, type Ctx } from "./context.js";
import type { TypesCache } from "./types-cache.js";
import {
  currentStatus,
  startActivity,
  stopActivity,
  pauseResumeActivity,
  logInterval,
  updateActivity,
  type CurrentStatus,
  type StartArgs,
  type StartedActivity,
  type StopArgs,
  type StoppedActivity,
  type PauseResumeArgs,
  type PauseResumeResult,
  type LogArgs,
  type LoggedInterval,
  type UpdateArgs,
  type UpdatedActivity,
} from "./tools/activities.js";
import { listTypes, type TypeNode } from "./tools/types.js";
import { timeReport, listIntervals, type ReportArgs, type TimeReport, type IntervalsPage } from "./tools/reports.js";

export { createApi, ApiError } from "./client.js";
export type { Api, ApiOptions, FetchLike } from "./client.js";
export type { ActivityTypeDto, ResolveOptions, TypesCache } from "./types-cache.js";
export type { ReportArgs, TimeReport, TypeTotal, PeriodTotal, IntervalsPage, DayEntry, IntervalEntry } from "./tools/reports.js";
export type {
  CurrentStatus,
  ActiveActivity,
  StartArgs,
  StartedActivity,
  StopArgs,
  StoppedActivity,
  PauseResumeArgs,
  PauseResumeResult,
  LogArgs,
  LoggedInterval,
  UpdateArgs,
  UpdatedActivity,
} from "./tools/activities.js";
export type { TypeNode } from "./tools/types.js";
export { PERIOD_WORDS, resolveRange, rangeDays, unixToLocal, wallTimeToUtc } from "./periods.js";
export type { PeriodWord, DateRange } from "./periods.js";
export { formatDuration } from "./format.js";
export { UsageError, NetworkError } from "./errors.js";

/**
 * One account's operations, sharing an HTTP client and its caches. Purely
 * in-process — no daemon, no persisted state, no cross-process reuse.
 *
 * Every field of the returned shapes is always present unless its type marks it
 * optional, so destructuring is safe on empty results. Durations come as both a
 * humanized string and raw `seconds`.
 *
 * Writes are here rather than left to `api` on purpose: the sequencing they
 * encode — resolving which activity is meant, mapping backdating onto the
 * backend's `?time=`, and `update`'s read-modify-write (a raw PUT soft-deletes
 * every interval missing from the payload) — is not something a caller should
 * re-derive. Unlike the CLI, which stays read-only because unattended shell
 * retries are hazardous, an embedder is writing a program and gets the tested
 * path.
 */
export interface AtlClient {
  /** Raw authenticated HTTP client — escape hatch for endpoints not wrapped here. */
  api: Api;
  /** Fuzzy type-name resolution against this account's type list. */
  typeCache: TypesCache;

  // reads
  status(timezone?: string): Promise<CurrentStatus>;
  types(includeArchived?: boolean): Promise<{ types: TypeNode[] }>;
  report(args: ReportArgs & { group_by?: "DAY" | "WEEK" | "MONTH" }): Promise<TimeReport>;
  intervals(args: ReportArgs & { page?: number; size?: number }): Promise<IntervalsPage>;

  // writes
  start(args: StartArgs): Promise<StartedActivity>;
  stop(args?: StopArgs): Promise<StoppedActivity>;
  pauseResume(args: PauseResumeArgs): Promise<PauseResumeResult>;
  log(args: LogArgs): Promise<LoggedInterval>;
  update(args: UpdateArgs): Promise<UpdatedActivity>;
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
    start: (args) => startActivity(args, ctx),
    stop: (args = {}) => stopActivity(args, ctx),
    pauseResume: (args) => pauseResumeActivity(args, ctx),
    log: (args) => logInterval(args, ctx),
    update: (args) => updateActivity(args, ctx),
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
  const config = readEnvConfig(); // throws on a botched setup; never exits, never warns
  if (!config.token) {
    throw new Error("ATL_TOKEN is not set — set it, or pass a token explicitly with createClient({ token }).");
  }
  return createClient({ token: config.token, baseUrl: config.baseUrl, fetch: overrides.fetch });
}
