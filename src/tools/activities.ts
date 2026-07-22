import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "../client.js";
import { resolveTypeById, resolveTypeName, typeNameById, type ActivityTypeDto } from "../types-cache.js";
import { effectiveTimezone } from "../timezone.js";
import { wallTimeToUtc, unixToLocal } from "../periods.js";
import { formatDuration, compact } from "../format.js";
import { textResult, withErrors } from "../errors.js";

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

async function currentStatus(tz: string): Promise<unknown> {
  const [data, names] = await Promise.all([api.get<ActivitiesDto>("/api/activities"), typeNameById()]);
  const active = (data.activities ?? []).filter((a) => a.status === "RUNNING" || a.status === "PAUSED");
  const now = unixToLocal(Date.now() / 1000, tz);
  if (active.length === 0) return { status: "idle", now, timezone: tz, message: "No running or paused activities." };
  return {
    now,
    timezone: tz,
    active: active.map((a) =>
      compact({
        activity: names.get(a.typeId) ?? a.typeId,
        id: a.id,
        status: a.status,
        started: a.start ? unixToLocal(Date.parse(a.start) / 1000, tz) : undefined,
        elapsed: formatDuration(a.duration),
        comment: a.comment,
        tags: a.tags,
      })
    ),
  };
}

async function findActiveActivity(
  typeName: string | undefined,
  statuses: string[],
  activityId?: string
): Promise<ActivityDto> {
  const [data, names] = await Promise.all([api.get<ActivitiesDto>("/api/activities"), typeNameById()]);
  const candidates = (data.activities ?? []).filter((a) => statuses.includes(a.status));
  if (candidates.length === 0) {
    throw new Error(`No ${statuses.join("/").toLowerCase()} activity found.`);
  }
  if (activityId) {
    const byId = candidates.find((a) => a.id === activityId);
    if (byId) return byId;
    throw new Error(
      `No ${statuses.join("/").toLowerCase()} activity with that id. Active: ${candidates
        .map((a) => `${names.get(a.typeId) ?? a.typeId} (${a.status}, id ${a.id})`)
        .join(", ")}`
    );
  }
  if (!typeName) {
    if (candidates.length === 1) return candidates[0];
    throw new Error(
      `Multiple activities are active, specify type_name. Active: ${candidates
        .map((a) => `${names.get(a.typeId) ?? a.typeId} (${a.status})`)
        .join(", ")}`
    );
  }
  const needle = typeName.trim().toLowerCase();
  const matched = candidates.filter((a) => (names.get(a.typeId) ?? "").toLowerCase().includes(needle));
  if (matched.length === 1) return matched[0];
  if (matched.length === 0) {
    throw new Error(
      `No active activity matches "${typeName}". Active: ${candidates
        .map((a) => `${names.get(a.typeId) ?? a.typeId} (${a.status})`)
        .join(", ")}`
    );
  }
  throw new Error(`"${typeName}" matches several active activities — be more specific.`);
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
    throw new Error(`\`at\` (${at} ${tz}) is in the future — backdating only.`);
  }
  return unix;
}

function resolveTimeArg(at: string | undefined, minutesAgo: number | undefined, tz: string): number {
  if (at !== undefined && minutesAgo !== undefined) {
    throw new Error("Pass either `at` or `*_minutes_ago`, not both.");
  }
  return at !== undefined ? atParam(at, tz) : timeParam(minutesAgo);
}

// Jackson on the server requires LocalDateTime exactly as yyyy-MM-dd'T'HH:mm:ss.SSS'Z' (UTC).
function toServerDateTime(d: Date): string {
  return d.toISOString();
}

async function resolveType(typeName: string | undefined, typeId: string | undefined): Promise<ActivityTypeDto> {
  if (typeId) return resolveTypeById(typeId);
  if (typeName) return resolveTypeName(typeName);
  throw new Error("Provide type_name or type_id.");
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
    withErrors(async ({ timezone }) => {
      const tz = await effectiveTimezone(timezone);
      return textResult(await currentStatus(tz));
    })
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
    withErrors(async ({ type_name, type_id, at, started_minutes_ago, timezone }) => {
      const type = await resolveType(type_name, type_id);
      const tz = await effectiveTimezone(timezone);
      await api.post(`/api/activities/start/${type.id}?time=${resolveTimeArg(at, started_minutes_ago, tz)}`);
      return textResult({ started: type.name, status: await currentStatus(tz) });
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
    withErrors(async ({ type_name, activity_id, at, stopped_minutes_ago, timezone }) => {
      const activity = await findActiveActivity(type_name, ["RUNNING", "PAUSED"], activity_id);
      const names = await typeNameById();
      const tz = await effectiveTimezone(timezone);
      await api.post(`/api/activities/stop/${activity.id}?time=${resolveTimeArg(at, stopped_minutes_ago, tz)}`);
      return textResult({
        stopped: names.get(activity.typeId) ?? activity.typeId,
        tracked: formatDuration(activity.duration),
      });
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
    withErrors(async ({ action, type_name, activity_id }) => {
      const statuses = action === "pause" ? ["RUNNING"] : ["PAUSED"];
      const activity = await findActiveActivity(type_name, statuses, activity_id);
      const names = await typeNameById();
      await api.post(`/api/activities/${action}/${activity.id}?time=0`);
      return textResult({ [action === "pause" ? "paused" : "resumed"]: names.get(activity.typeId) ?? activity.typeId });
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
    withErrors(async ({ type_name, type_id, from, to, comment, tags, timezone }) => {
      const type = await resolveType(type_name, type_id);
      const tz = await effectiveTimezone(timezone);
      const start = wallTimeToUtc(from, tz);
      const finish = wallTimeToUtc(to, tz);
      if (finish.getTime() <= start.getTime()) {
        throw new Error("`to` must be after `from`.");
      }
      await api.post("/api/activities", {
        typeId: type.id,
        status: "STOPPED",
        comment: comment ?? "",
        tags: tags ?? [],
        intervals: [{ start: toServerDateTime(start), finish: toServerDateTime(finish) }],
      });
      return textResult({
        logged: type.name,
        from: `${from} (${tz})`,
        to,
        duration: formatDuration((finish.getTime() - start.getTime()) / 1000),
        comment: comment || undefined,
        tags,
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
    withErrors(async ({ activity_id, comment, tags }) => {
      if (comment === undefined && tags === undefined) {
        throw new Error("Nothing to update — provide comment and/or tags.");
      }
      // Read-modify-write: the backend PUT replaces the whole activity, and any
      // interval missing from the payload gets deleted — so round-trip the
      // record verbatim and touch only the requested fields.
      const activity = await api.get<ActivityDto>(`/api/activities/${activity_id}`);
      if (comment !== undefined) activity.comment = comment;
      if (tags !== undefined) activity.tags = tags;
      await api.put(`/api/activities/${activity_id}`, activity);
      const [updated, names] = await Promise.all([
        api.get<ActivityDto>(`/api/activities/${activity_id}`),
        typeNameById(),
      ]);
      return textResult(
        compact({
          updated: names.get(updated.typeId) ?? updated.typeId,
          id: updated.id,
          status: updated.status,
          comment: updated.comment,
          tags: updated.tags,
          tracked: formatDuration(updated.duration),
        })
      );
    })
  );
}
