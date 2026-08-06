import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defaultContext, type Ctx } from "../context.js";
import { PERIOD_WORDS, resolveRange, rangeDays, unixToLocal, type DateRange, type PeriodWord } from "../periods.js";
import { formatDuration, compact } from "../format.js";
import { textResult, withErrors, UsageError } from "../errors.js";

const rangeSchema = {
  period: z
    .enum(PERIOD_WORDS)
    .optional()
    .describe("Named period; alternative to explicit from/to"),
  from: z.string().optional().describe("Start date yyyy-MM-dd (use with `to`)"),
  to: z.string().optional().describe("End date yyyy-MM-dd, inclusive"),
  type_names: z.array(z.string()).optional().describe("Filter to these activity type names (groups allowed)"),
  type_ids: z.array(z.string()).optional().describe("Filter to these exact activity type ids (internal — never show ids to the user)"),
  tags: z.array(z.string()).optional().describe("Filter to these tags"),
  timezone: z.string().optional().describe("IANA timezone (default: user's timezone)"),
};

interface StatItem {
  types: string[];
  duration: number;
  children?: StatItem[];
}

interface PeriodStatistic {
  title: string;
  info: { total: number };
  statistics: StatItem[];
  groupedStatistics: StatItem[];
}

interface StatisticsDto {
  periods: PeriodStatistic[];
  total: PeriodStatistic;
}

/** Time attributed to one activity type (or a group, with its children). */
export interface TypeTotal {
  type: string;
  duration: string;
  seconds: number;
  children?: TypeTotal[];
}

function shapeStatItems(items: StatItem[] | undefined, names: Map<string, string>): TypeTotal[] {
  if (!items) return [];
  return items
    .slice()
    .sort((a, b) => b.duration - a.duration)
    .map((item) => {
      const node: TypeTotal = {
        type: item.types.map((id) => names.get(id) ?? id).join(" + "),
        duration: formatDuration(item.duration),
        seconds: item.duration,
      };
      const children = shapeStatItems(item.children, names);
      if (children.length > 0) node.children = children;
      return node;
    });
}

interface IntervalDto {
  id: string;
  activityId?: string;
  from: number;
  to: number;
  typeId: string;
  duration: number;
  comment?: string;
  tags?: string[];
}

interface DayHistory {
  title: string;
  intervals: IntervalDto[];
}

interface PageDto<T> {
  content: T[];
  totalElements: number;
  number: number;
  totalPages: number;
  last: boolean;
}

export interface ReportArgs {
  /** Named period; mutually exclusive with `from`/`to`. */
  period?: PeriodWord;
  /** Start date yyyy-MM-dd, inclusive; requires `to`. */
  from?: string;
  /** End date yyyy-MM-dd, inclusive; requires `from`. */
  to?: string;
  /** Activity type names, fuzzy matched (groups allowed). */
  type_names?: string[];
  type_ids?: string[];
  tags?: string[];
  /** IANA timezone; defaults to the account's. */
  timezone?: string;
}

/** One bucket of the per-DAY/WEEK/MONTH breakdown. */
export interface PeriodTotal {
  period: string;
  duration: string;
  seconds: number;
}

export interface TimeReport {
  range: DateRange;
  timezone: string;
  /** Humanized total, e.g. "2h 15m". */
  duration: string;
  seconds: number;
  by_type: TypeTotal[];
  /** Every bucket in the range, including empty ones. */
  periods: PeriodTotal[];
}

export interface IntervalEntry {
  type: string;
  /** Interval id. */
  id: string;
  /** Owning activity — pass to update_activity / PUT /api/activities/{id}. */
  activity_id?: string;
  /** Wall-clock "yyyy-MM-dd HH:mm" in `timezone`. */
  from: string;
  to: string;
  duration: string;
  seconds: number;
  comment?: string;
  tags?: string[];
}

export interface DayEntry {
  day: string;
  intervals: IntervalEntry[];
}

export interface IntervalsPage {
  range: DateRange;
  timezone: string;
  days: DayEntry[];
  page: number;
  total_days: number;
  total_pages: number;
  has_more: boolean;
}

export async function timeReport(
  args: ReportArgs & { group_by?: "DAY" | "WEEK" | "MONTH" },
  ctx: Ctx = defaultContext()
): Promise<TimeReport> {
  const tz = await ctx.timezone.effectiveTimezone(args.timezone);
  const range = resolveRange(args, tz);
  const [resolved, names] = await Promise.all([
    ctx.types.resolveTypeNames(args.type_names, { allowGroups: true }),
    ctx.types.typeNameById(),
  ]);
  const types = [...(resolved ?? []), ...(args.type_ids ?? [])];
  const stats = await ctx.api.post<StatisticsDto>("/api/statistics", {
    types: types.length > 0 ? types : undefined,
    tags: args.tags && args.tags.length > 0 ? args.tags : undefined,
    from: range.from,
    to: range.to,
    timezone: tz,
    groupBy: args.group_by ?? "DAY",
  });
  const seconds = stats.total?.info?.total ?? 0;
  return {
    range,
    timezone: tz,
    duration: formatDuration(seconds),
    seconds,
    by_type: shapeStatItems(stats.total?.groupedStatistics, names),
    periods: (stats.periods ?? []).map((p) => ({
      period: p.title,
      duration: formatDuration(p.info?.total ?? 0),
      seconds: p.info?.total ?? 0,
    })),
  };
}

export async function listIntervals(
  args: ReportArgs & { page?: number; size?: number },
  ctx: Ctx = defaultContext()
): Promise<IntervalsPage> {
  const tz = await ctx.timezone.effectiveTimezone(args.timezone);
  const range = resolveRange(args, tz);
  if (rangeDays(range) > 100) {
    throw new UsageError("Date range too large — the history API allows at most 100 days per request.");
  }
  const [resolved, names] = await Promise.all([
    ctx.types.resolveTypeNames(args.type_names, { allowGroups: true }),
    ctx.types.typeNameById(),
  ]);
  const types = [...(resolved ?? []), ...(args.type_ids ?? [])];
  const result = await ctx.api.post<PageDto<DayHistory>>(
    `/api/intervals?page=${args.page ?? 0}&size=${args.size ?? 20}`,
    {
      types: types.length > 0 ? types : undefined,
      tags: args.tags && args.tags.length > 0 ? args.tags : undefined,
      from: range.from,
      to: range.to,
      timezone: tz,
    }
  );
  return {
    range,
    timezone: tz,
    days: (result.content ?? []).map((day) => ({
      day: day.title,
      intervals: (day.intervals ?? []).map((i) => {
        const entry: IntervalEntry = {
          type: names.get(i.typeId) ?? i.typeId,
          id: i.id,
          from: unixToLocal(i.from, tz),
          to: unixToLocal(i.to, tz),
          duration: formatDuration(i.duration),
          seconds: i.duration,
        };
        if (i.activityId) entry.activity_id = i.activityId;
        if (i.comment) entry.comment = i.comment;
        if (i.tags && i.tags.length > 0) entry.tags = i.tags;
        return entry;
      }),
    })),
    page: result.number,
    total_days: result.totalElements,
    total_pages: result.totalPages,
    has_more: result.last === false,
  };
}

/* --- MCP presentation -------------------------------------------------------
 * The tools speak to an LLM: keys with no value are dropped to save tokens,
 * paging is prose, and raw seconds are omitted where a humanized duration
 * already says it. Library and CLI consumers get the stable shapes above. */

function reportForMcp(r: TimeReport): unknown {
  return compact({
    range: r.range,
    timezone: r.timezone,
    total: r.duration,
    by_type: r.by_type,
    periods: r.periods.filter((p) => p.seconds > 0).map((p) => ({ period: p.period, total: p.duration })),
  });
}

function intervalsForMcp(p: IntervalsPage): unknown {
  return compact({
    range: p.range,
    timezone: p.timezone,
    days: p.days.map((day) => ({
      day: day.day,
      intervals: day.intervals.map((i) =>
        compact({
          type: i.type,
          id: i.id,
          activity_id: i.activity_id,
          from: i.from,
          to: i.to,
          duration: i.duration,
          comment: i.comment,
          tags: i.tags,
        })
      ),
    })),
    page: p.page,
    total_days: p.total_days,
    more: p.has_more ? "yes — request the next page" : undefined,
  });
}

export function registerReportTools(server: McpServer): void {
  server.registerTool(
    "time_report",
    {
      description:
        "Aggregated time statistics per activity type for a date range. " +
        "Returns overall totals plus per-DAY/WEEK/MONTH buckets.",
      inputSchema: {
        ...rangeSchema,
        group_by: z.enum(["DAY", "WEEK", "MONTH"]).optional().describe("Bucket size for the periods breakdown (default DAY)"),
      },
    },
    withErrors(async (args) => textResult(reportForMcp(await timeReport(args))))
  );

  server.registerTool(
    "list_intervals",
    {
      description:
        "List raw time entries (intervals) grouped by day for a date range (max 100 days). " +
        "Paged by day — use `page` for older days.",
      inputSchema: {
        ...rangeSchema,
        page: z.number().int().min(0).optional().describe("Page number, 0-based (default 0)"),
        size: z.number().int().min(1).max(50).optional().describe("Days per page (default 20, max 50)"),
      },
    },
    withErrors(async (args) => textResult(intervalsForMcp(await listIntervals(args))))
  );
}
