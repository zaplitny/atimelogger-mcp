import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { api } from "../client.js";
import { resolveTypeNames, typeNameById } from "../types-cache.js";
import { effectiveTimezone } from "../timezone.js";
import { PERIOD_WORDS, resolveRange, rangeDays, unixToLocal } from "../periods.js";
import { formatDuration, compact } from "../format.js";
import { textResult, withErrors } from "../errors.js";

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

function shapeStatItems(items: StatItem[] | undefined, names: Map<string, string>): unknown[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items
    .slice()
    .sort((a, b) => b.duration - a.duration)
    .map((item) =>
      compact({
        type: item.types.map((id) => names.get(id) ?? id).join(" + "),
        duration: formatDuration(item.duration),
        seconds: item.duration,
        children: shapeStatItems(item.children, names),
      })
    );
}

interface IntervalDto {
  id: string;
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
    withErrors(async ({ period, from, to, type_names, type_ids, tags, timezone, group_by }) => {
      const tz = await effectiveTimezone(timezone);
      const range = resolveRange({ period, from, to }, tz);
      const [resolved, names] = await Promise.all([resolveTypeNames(type_names, { allowGroups: true }), typeNameById()]);
      const types = [...(resolved ?? []), ...(type_ids ?? [])];
      const stats = await api.post<StatisticsDto>("/api/statistics", {
        types: types.length > 0 ? types : undefined,
        tags: tags && tags.length > 0 ? tags : undefined,
        from: range.from,
        to: range.to,
        timezone: tz,
        groupBy: group_by ?? "DAY",
      });
      return textResult(
        compact({
          range,
          timezone: tz,
          total: formatDuration(stats.total?.info?.total ?? 0),
          by_type: shapeStatItems(stats.total?.groupedStatistics, names),
          periods: (stats.periods ?? [])
            .filter((p) => (p.info?.total ?? 0) > 0)
            .map((p) => ({ period: p.title, total: formatDuration(p.info.total) })),
        })
      );
    })
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
    withErrors(async ({ period, from, to, type_names, type_ids, tags, timezone, page, size }) => {
      const tz = await effectiveTimezone(timezone);
      const range = resolveRange({ period, from, to }, tz);
      if (rangeDays(range) > 100) {
        throw new Error("Date range too large — the history API allows at most 100 days per request.");
      }
      const [resolved, names] = await Promise.all([resolveTypeNames(type_names, { allowGroups: true }), typeNameById()]);
      const types = [...(resolved ?? []), ...(type_ids ?? [])];
      const result = await api.post<PageDto<DayHistory>>(
        `/api/intervals?page=${page ?? 0}&size=${size ?? 20}`,
        {
          types: types.length > 0 ? types : undefined,
          tags: tags && tags.length > 0 ? tags : undefined,
          from: range.from,
          to: range.to,
          timezone: tz,
        }
      );
      return textResult(
        compact({
          range,
          timezone: tz,
          days: (result.content ?? []).map((day) => ({
            day: day.title,
            intervals: (day.intervals ?? []).map((i) =>
              compact({
                type: names.get(i.typeId) ?? i.typeId,
                id: i.id,
                from: unixToLocal(i.from, tz),
                to: unixToLocal(i.to, tz),
                duration: formatDuration(i.duration),
                comment: i.comment,
                tags: i.tags,
              })
            ),
          })),
          page: result.number,
          total_days: result.totalElements,
          more: result.last === false ? "yes — request the next page" : undefined,
        })
      );
    })
  );
}
