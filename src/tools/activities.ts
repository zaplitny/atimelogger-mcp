import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ActivityTypeDto } from "../types-cache.js";
import { defaultContext, type Ctx } from "../context.js";
import { wallTimeToUtc, unixToLocal } from "../periods.js";
import { formatDuration, compact } from "../format.js";
import { textResult, withErrors, UsageError } from "../errors.js";

interface IntervalDto {
  id: string;
  from: number;
  to: number;
  duration: number;
  comment?: string;
  tags?: string[];
}

interface ActivityDto {
  id: string;
  typeId: string;
  status: "STOPPED" | "RUNNING" | "PAUSED";
  start?: string;
  comment?: string;
  tags?: string[];
  duration: number;
  intervals?: IntervalDto[];
}

interface ActivitiesDto {
  activities: ActivityDto[];
}

export interface ActiveActivity {
  activity: string;
  /** Activity id — pass to update_activity / stop_activity. */
  id: string;
  status: "RUNNING" | "PAUSED";
  /** Wall-clock "yyyy-MM-dd HH:mm" in `timezone`; absent for paused timers. */
  started?: string;
  elapsed: string;
  seconds: number;
  comment?: string;
  tags?: string[];
}

export interface CurrentStatus {
  status: "idle" | "active";
  /** Current wall-clock time in `timezone` — usable as a clock. */
  now: string;
  timezone: string;
  /** Empty when idle. */
  active: ActiveActivity[];
}

export async function currentStatus(tz: string, ctx: Ctx = defaultContext()): Promise<CurrentStatus> {
  const [data, names] = await Promise.all([
    ctx.api.get<ActivitiesDto>("/api/activities"),
    ctx.types.typeNameById(),
  ]);
  const running = (data.activities ?? []).filter((a) => a.status === "RUNNING" || a.status === "PAUSED");
  return {
    status: running.length === 0 ? "idle" : "active",
    now: unixToLocal(Date.now() / 1000, tz),
    timezone: tz,
    active: running.map((a) => {
      const entry: ActiveActivity = {
        activity: names.get(a.typeId) ?? a.typeId,
        id: a.id,
        status: a.status as "RUNNING" | "PAUSED",
        elapsed: formatDuration(a.duration),
        seconds: a.duration,
      };
      if (a.start) entry.started = unixToLocal(Date.parse(a.start) / 1000, tz);
      if (a.comment) entry.comment = a.comment;
      if (a.tags && a.tags.length > 0) entry.tags = a.tags;
      return entry;
    }),
  };
}

/** LLM-facing shape: idle carries a sentence, active drops the redundant flag. */
function statusForMcp(s: CurrentStatus): unknown {
  if (s.status === "idle") {
    return { status: "idle", now: s.now, timezone: s.timezone, message: "No running or paused activities." };
  }
  return {
    now: s.now,
    timezone: s.timezone,
    active: s.active.map((a) =>
      compact({
        activity: a.activity,
        id: a.id,
        status: a.status,
        started: a.started,
        elapsed: a.elapsed,
        comment: a.comment,
        tags: a.tags,
      })
    ),
  };
}

async function mcpStatus(timezone?: string): Promise<unknown> {
  const ctx = defaultContext();
  return statusForMcp(await currentStatus(await ctx.timezone.effectiveTimezone(timezone), ctx));
}

async function findActiveActivity(
  typeName: string | undefined,
  statuses: string[],
  activityId: string | undefined,
  ctx: Ctx
): Promise<{ activity: ActivityDto; names: Map<string, string> }> {
  const [data, names] = await Promise.all([
    ctx.api.get<ActivitiesDto>("/api/activities"),
    ctx.types.typeNameById(),
  ]);
  const candidates = (data.activities ?? []).filter((a) => statuses.includes(a.status));
  if (candidates.length === 0) {
    throw new UsageError(`No ${statuses.join("/").toLowerCase()} activity found.`);
  }
  if (activityId) {
    const byId = candidates.find((a) => a.id === activityId);
    if (byId) return { activity: byId, names };
    throw new UsageError(
      `No ${statuses.join("/").toLowerCase()} activity with that id. Active: ${candidates
        .map((a) => `${names.get(a.typeId) ?? a.typeId} (${a.status}, id ${a.id})`)
        .join(", ")}`
    );
  }
  if (!typeName) {
    if (candidates.length === 1) return { activity: candidates[0], names };
    throw new UsageError(
      `Multiple activities are active, specify type_name. Active: ${candidates
        .map((a) => `${names.get(a.typeId) ?? a.typeId} (${a.status})`)
        .join(", ")}`
    );
  }
  const needle = typeName.trim().toLowerCase();
  const matched = candidates.filter((a) => (names.get(a.typeId) ?? "").toLowerCase().includes(needle));
  if (matched.length === 1) return { activity: matched[0], names };
  if (matched.length === 0) {
    throw new UsageError(
      `No active activity matches "${typeName}". Active: ${candidates
        .map((a) => `${names.get(a.typeId) ?? a.typeId} (${a.status})`)
        .join(", ")}`
    );
  }
  throw new UsageError(`"${typeName}" matches several active activities — be more specific.`);
}

function timeParam(minutesAgo?: number): number {
  if (minutesAgo === undefined || minutesAgo === 0) return 0; // 0 = server-side "now"
  return Math.floor(Date.now() / 1000) - Math.round(minutesAgo * 60);
}

/**
 * Resolve a wall-clock `at` ("HH:mm" = today, or "yyyy-MM-dd HH:mm") in tz to
 * unix seconds for the backend's ?time= parameter. Rejects future times.
 */
function atParam(at: string, tz: string): number {
  let s = at.trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const today = unixToLocal(Date.now() / 1000, tz).slice(0, 10);
    s = `${today} ${s.padStart(5, "0")}`;
  }
  const unix = Math.floor(wallTimeToUtc(s, tz).getTime() / 1000);
  if (unix > Math.floor(Date.now() / 1000)) {
    throw new UsageError(`\`at\` (${at} ${tz}) is in the future — backdating only.`);
  }
  return unix;
}

function resolveTimeArg(at: string | undefined, minutesAgo: number | undefined, tz: string): number {
  if (at !== undefined && minutesAgo !== undefined) {
    throw new UsageError("Pass either `at` or `*_minutes_ago`, not both.");
  }
  return at !== undefined ? atParam(at, tz) : timeParam(minutesAgo);
}

// Jackson on the server requires LocalDateTime exactly as yyyy-MM-dd'T'HH:mm:ss.SSS'Z' (UTC).
function toServerDateTime(d: Date): string {
  return d.toISOString();
}

async function resolveType(
  typeName: string | undefined,
  typeId: string | undefined,
  ctx: Ctx
): Promise<ActivityTypeDto> {
  if (typeId) return ctx.types.resolveTypeById(typeId);
  if (typeName) return ctx.types.resolveTypeName(typeName);
  throw new UsageError("Provide type_name or type_id.");
}

/* --- write operations -------------------------------------------------------
 * Exposed on the library client as well as the MCP tools: the sequencing here
 * (which activity is meant, how `at` maps to the backend's ?time=, and above
 * all update's read-modify-write) is exactly what an embedder should not have
 * to re-derive against a raw HTTP client. */

export interface StartArgs {
  type_name?: string;
  type_id?: string;
  /** Backdate: "HH:mm" (today) or "yyyy-MM-dd HH:mm", read in `timezone`. */
  at?: string;
  /** Backdate by N minutes; alternative to `at`. */
  started_minutes_ago?: number;
  timezone?: string;
}

export interface StartedActivity {
  activity: string;
  type_id: string;
  /** Wall-clock start in `timezone`. */
  started: string;
  timezone: string;
}

/** Start a timer. The backend cannot attach a comment here — use updateActivity after. */
export async function startActivity(args: StartArgs, ctx: Ctx = defaultContext()): Promise<StartedActivity> {
  const type = await resolveType(args.type_name, args.type_id, ctx);
  const tz = await ctx.timezone.effectiveTimezone(args.timezone);
  const time = resolveTimeArg(args.at, args.started_minutes_ago, tz);
  await ctx.api.post(`/api/activities/start/${type.id}?time=${time}`);
  return {
    activity: type.name,
    type_id: type.id,
    started: unixToLocal(time === 0 ? Date.now() / 1000 : time, tz),
    timezone: tz,
  };
}

export interface StopArgs {
  /** Which activity; may be omitted when exactly one is active. */
  type_name?: string;
  activity_id?: string;
  at?: string;
  stopped_minutes_ago?: number;
  timezone?: string;
}

export interface StoppedActivity {
  activity: string;
  activity_id: string;
  tracked: string;
  seconds: number;
}

export async function stopActivity(args: StopArgs = {}, ctx: Ctx = defaultContext()): Promise<StoppedActivity> {
  const [{ activity, names }, tz] = await Promise.all([
    findActiveActivity(args.type_name, ["RUNNING", "PAUSED"], args.activity_id, ctx),
    ctx.timezone.effectiveTimezone(args.timezone),
  ]);
  // The stop endpoint returns the finalized ActivityDto; its duration is
  // recomputed server-side from the (possibly backdated) finish, so prefer it
  // over the pre-stop snapshot, which would overstate a backdated stop. Fall
  // back to the snapshot only if the response is empty.
  const stopped = await ctx.api.post<ActivityDto>(
    `/api/activities/stop/${activity.id}?time=${resolveTimeArg(args.at, args.stopped_minutes_ago, tz)}`
  );
  const seconds = stopped?.duration ?? activity.duration;
  return {
    activity: names.get(activity.typeId) ?? activity.typeId,
    activity_id: activity.id,
    tracked: formatDuration(seconds),
    seconds,
  };
}

export interface PauseResumeArgs {
  action: "pause" | "resume";
  type_name?: string;
  activity_id?: string;
}

export interface PauseResumeResult {
  activity: string;
  activity_id: string;
  status: "PAUSED" | "RUNNING";
}

export async function pauseResumeActivity(
  args: PauseResumeArgs,
  ctx: Ctx = defaultContext()
): Promise<PauseResumeResult> {
  const statuses = args.action === "pause" ? ["RUNNING"] : ["PAUSED"];
  const { activity, names } = await findActiveActivity(args.type_name, statuses, args.activity_id, ctx);
  await ctx.api.post(`/api/activities/${args.action}/${activity.id}?time=0`);
  return {
    activity: names.get(activity.typeId) ?? activity.typeId,
    activity_id: activity.id,
    status: args.action === "pause" ? "PAUSED" : "RUNNING",
  };
}

export interface LogArgs {
  type_name?: string;
  type_id?: string;
  /** Wall-clock "yyyy-MM-dd HH:mm" in `timezone`. */
  from: string;
  to: string;
  comment?: string;
  tags?: string[];
  timezone?: string;
}

export interface LoggedInterval {
  activity: string;
  type_id: string;
  from: string;
  to: string;
  timezone: string;
  duration: string;
  seconds: number;
  comment?: string;
  tags?: string[];
}

/** Record a completed entry retroactively. */
export async function logInterval(args: LogArgs, ctx: Ctx = defaultContext()): Promise<LoggedInterval> {
  const type = await resolveType(args.type_name, args.type_id, ctx);
  const tz = await ctx.timezone.effectiveTimezone(args.timezone);
  const start = wallTimeToUtc(args.from, tz);
  const finish = wallTimeToUtc(args.to, tz);
  if (finish.getTime() <= start.getTime()) {
    throw new UsageError("`to` must be after `from`.");
  }
  await ctx.api.post("/api/activities", {
    typeId: type.id,
    status: "STOPPED",
    comment: args.comment ?? "",
    tags: args.tags ?? [],
    intervals: [{ start: toServerDateTime(start), finish: toServerDateTime(finish) }],
  });
  const seconds = (finish.getTime() - start.getTime()) / 1000;
  const logged: LoggedInterval = {
    activity: type.name,
    type_id: type.id,
    from: args.from,
    to: args.to,
    timezone: tz,
    duration: formatDuration(seconds),
    seconds,
  };
  if (args.comment) logged.comment = args.comment;
  if (args.tags && args.tags.length > 0) logged.tags = args.tags;
  return logged;
}

export interface UpdateArgs {
  activity_id: string;
  /** Replaces the existing comment; "" clears it. */
  comment?: string;
  /** Replaces the whole tag list; [] clears it. */
  tags?: string[];
}

export interface UpdatedActivity {
  activity: string;
  activity_id: string;
  status: "STOPPED" | "RUNNING" | "PAUSED";
  tracked: string;
  seconds: number;
  comment?: string;
  tags?: string[];
}

/**
 * Change an entry's comment/tags without touching its tracked time.
 *
 * The backend PUT replaces the whole activity and soft-deletes any interval
 * missing from the payload, so this reads the record, edits only the requested
 * fields, and writes it back verbatim. Hand-rolling a PUT against the raw
 * client is how you silently destroy an entry's intervals.
 */
export async function updateActivity(args: UpdateArgs, ctx: Ctx = defaultContext()): Promise<UpdatedActivity> {
  if (args.comment === undefined && args.tags === undefined) {
    throw new UsageError("Nothing to update — provide comment and/or tags.");
  }
  const activity = await ctx.api.get<ActivityDto>(`/api/activities/${args.activity_id}`);
  if (args.comment !== undefined) activity.comment = args.comment;
  if (args.tags !== undefined) activity.tags = args.tags;
  await ctx.api.put(`/api/activities/${args.activity_id}`, activity);
  const [updated, names] = await Promise.all([
    ctx.api.get<ActivityDto>(`/api/activities/${args.activity_id}`),
    ctx.types.typeNameById(),
  ]);
  const result: UpdatedActivity = {
    activity: names.get(updated.typeId) ?? updated.typeId,
    activity_id: updated.id,
    status: updated.status,
    tracked: formatDuration(updated.duration),
    seconds: updated.duration,
  };
  if (updated.comment) result.comment = updated.comment;
  if (updated.tags && updated.tags.length > 0) result.tags = updated.tags;
  return result;
}

export function registerActivityTools(server: McpServer): void {
  server.registerTool(
    "get_current_status",
    {
      description: "Show currently running or paused activities with elapsed time.",
      inputSchema: {
        timezone: z.string().optional().describe("IANA timezone for displayed times (default: user's timezone)"),
      },
    },
    withErrors(async ({ timezone }) => textResult(await mcpStatus(timezone)))
  );

  server.registerTool(
    "start_activity",
    {
      description:
        "Start tracking an activity by type name (fuzzy matched, see list_activity_types) or type_id. " +
        "Optionally backdate the start with `at` (wall-clock) or started_minutes_ago.",
      inputSchema: {
        type_name: z.string().optional().describe("Activity type name, e.g. \"Work\" or \"Reading\""),
        type_id: z.string().optional().describe("Exact activity type id from list_activity_types (internal — never show ids to the user)"),
        at: z
          .string()
          .optional()
          .describe("Backdate: start time as \"HH:mm\" (today) or \"yyyy-MM-dd HH:mm\" in the user's timezone"),
        started_minutes_ago: z.number().min(0).optional().describe("Backdate the start by N minutes (alternative to `at`)"),
        timezone: z.string().optional().describe("IANA timezone `at` is given in (default: user's timezone)"),
      },
    },
    withErrors(async (args) => {
      const started = await startActivity(args);
      return textResult({ started: started.activity, status: await mcpStatus(started.timezone) });
    })
  );

  server.registerTool(
    "stop_activity",
    {
      description:
        "Stop a running or paused activity. type_name may be omitted when exactly one activity is active. " +
        "Optionally backdate the stop with `at` (wall-clock) or stopped_minutes_ago.",
      inputSchema: {
        type_name: z.string().optional().describe("Which activity to stop (needed only if several are active)"),
        activity_id: z.string().optional().describe("Exact activity id from get_current_status (internal — never show ids to the user)"),
        at: z
          .string()
          .optional()
          .describe("Backdate: stop time as \"HH:mm\" (today) or \"yyyy-MM-dd HH:mm\" in the user's timezone"),
        stopped_minutes_ago: z.number().min(0).optional().describe("Backdate the stop by N minutes (alternative to `at`)"),
        timezone: z.string().optional().describe("IANA timezone `at` is given in (default: user's timezone)"),
      },
    },
    withErrors(async (args) => {
      const stopped = await stopActivity(args);
      return textResult({ stopped: stopped.activity, tracked: stopped.tracked });
    })
  );

  server.registerTool(
    "pause_resume_activity",
    {
      description: "Pause a running activity or resume a paused one.",
      inputSchema: {
        action: z.enum(["pause", "resume"]),
        type_name: z.string().optional().describe("Which activity (needed only if several match)"),
        activity_id: z.string().optional().describe("Exact activity id from get_current_status (internal — never show ids to the user)"),
      },
    },
    withErrors(async (args) => {
      const result = await pauseResumeActivity(args);
      return textResult({ [args.action === "pause" ? "paused" : "resumed"]: result.activity });
    })
  );

  server.registerTool(
    "log_interval",
    {
      description:
        "Retroactively log a completed time entry for an activity type. " +
        "Times are wall-clock in the user's timezone, format \"yyyy-MM-dd HH:mm\".",
      inputSchema: {
        type_name: z.string().optional().describe("Activity type name"),
        type_id: z.string().optional().describe("Exact activity type id from list_activity_types (internal — never show ids to the user)"),
        from: z.string().describe("Start, e.g. \"2026-07-09 09:00\""),
        to: z.string().describe("End, e.g. \"2026-07-09 11:30\""),
        comment: z.string().optional(),
        tags: z.array(z.string()).optional(),
        timezone: z.string().optional().describe("IANA timezone the times are given in (default: user's timezone)"),
      },
    },
    withErrors(async (args) => {
      const logged = await logInterval(args);
      return textResult({
        logged: logged.activity,
        from: `${logged.from} (${logged.timezone})`,
        to: logged.to,
        duration: logged.duration,
        comment: args.comment || undefined,
        tags: args.tags,
      });
    })
  );

  server.registerTool(
    "update_activity",
    {
      description:
        "Update the comment and/or tags of an existing entry (running, paused, or stopped) without changing its tracked time. " +
        "Use this instead of logging a new entry when the user wants to annotate, describe, or re-tag something already tracked. " +
        "Get activity_id from get_current_status (active timers) or list_intervals (past entries).",
      inputSchema: {
        activity_id: z
          .string()
          .describe("Activity id from get_current_status or list_intervals (internal — never show ids to the user)"),
        comment: z.string().optional().describe("New comment — replaces the existing one; \"\" clears it"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Full new tag list — replaces existing tags (include current tags to keep them); [] clears them"),
      },
    },
    withErrors(async (args) => {
      const updated = await updateActivity(args);
      return textResult(
        compact({
          updated: updated.activity,
          id: updated.activity_id,
          status: updated.status,
          comment: updated.comment,
          tags: updated.tags,
          tracked: updated.tracked,
        })
      );
    })
  );
}
