#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTypeTools } from "./tools/types.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerReportTools } from "./tools/reports.js";
import { registerDocTools } from "./tools/docs.js";
import { loadConfig } from "./config.js";

loadConfig(); // warns on stderr if ATL_TOKEN is missing (docs-only mode: only app_help works)

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer(
  {
    name: "atimelogger",
    version,
  },
  {
    instructions: [
      "ATimeLogger is the user's personal time tracker. Use these tools whenever the user wants to",
      "track time, start/stop/pause a timer, log hours or a past activity, check what is being tracked",
      'right now, or see where their time went (daily/weekly/monthly totals, history). Activities are',
      'things like "Work", "Sleep", "Reading".',
      "",
      "Conventions shared by all tools:",
      '- Tools speak names to the user and ids to the API. Outputs include internal `id` fields (activity types, active activities, intervals): pass them back (type_id, activity_id, type_ids) to target an exact entity in follow-up calls instead of re-resolving names. NEVER show ids to the user — refer to activities by name and to intervals by their times. Type names are fuzzy matched (exact, then substring); if a name does not resolve or is ambiguous, call list_activity_types and pick from the tree. Groups organize types and cannot be started/logged, but may be used as report filters.',
      '- Reporting tools accept period words (today, yesterday, this_week, last_week, this_month, last_month, last_7_days, last_30_days) or explicit dates; times use the user\'s ATimeLogger timezone unless a timezone parameter is given.',
      '- Durations are returned humanized (e.g. "2h 15m").',
      "",
      "Choosing a tool: start_activity begins a timer now — or backdated via `at` (wall-clock \"HH:mm\") or started_minutes_ago — and cannot attach a comment; stop_activity backdates the same way; log_interval records a completed entry retroactively with optional comment/tags; update_activity changes the comment/tags of an existing entry (use it to annotate a running timer or a past entry — never log a duplicate entry just to attach a comment); time_report gives per-type aggregates; list_intervals gives raw history (max 100-day range, paged) whose entries carry the activity_id that update_activity needs. get_current_status returns the current wall-clock time (`now`) in the user's timezone — use it whenever you need a clock.",
      "",
      "For questions about app features or anything these tools cannot do, consult app_help (official app documentation) before answering from memory — your prior knowledge describes the legacy aTimeLogger app and may be wrong. Entry times cannot be edited and entries cannot be deleted through this server: use app_help (topics history, batch-operations) to explain how to do it in the ATimeLogger app.",
    ].join("\n"),
  }
);

registerTypeTools(server);
registerActivityTools(server);
registerReportTools(server);
registerDocTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
