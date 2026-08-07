#!/usr/bin/env node
/**
 * atimelogger-cli — minimal read-only JSON CLI beside the MCP server (issue #3).
 *
 * One-shot commands for scripts and automation; output is always JSON on
 * stdout (pretty by default, single-line with --compact). Errors go to stderr
 * as {"error": "..."} with exit code 1 for runtime/API failures and 2 for
 * usage mistakes. Same env as the MCP server: ATL_TOKEN (required),
 * ATL_BASE_URL (optional).
 */
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { PERIOD_WORDS, type PeriodWord } from "./periods.js";
import { UsageError } from "./errors.js";

const GROUP_BY = ["DAY", "WEEK", "MONTH"] as const;

const HELP = `atimelogger-cli — read-only JSON access to ATimeLogger

Usage: atimelogger-cli <command> [options]

Commands:
  status                     Running/paused activities with elapsed time
  types                      Activity types as a tree (--archived to include archived)
  report                     Aggregated per-type statistics for a range
  intervals                  Raw history grouped by day for a range (max 100 days)
  doctor                     Check token, connectivity and account setup (exit 1 if unhealthy)

Range options (report, intervals):
  --period <word>            One of: ${PERIOD_WORDS.join(", ")}
  --from <yyyy-MM-dd>        Explicit range start (use with --to)
  --to <yyyy-MM-dd>          Explicit range end, inclusive
  --type <name>              Filter by activity type name (repeatable, fuzzy matched)
  --tag <tag>                Filter by tag (repeatable)

Other options:
  --group-by <${GROUP_BY.join("|")}>  report: bucket size for the periods breakdown
  --page <n> --size <n>        intervals: paging (0-based page, 1-50 days per page)
  --timezone <iana>            Times in this timezone (default: account timezone)
  --archived                   types: include archived types
  --compact                    Single-line JSON output
  -h, --help                   Show this help
  -v, --version                Show version

Environment:
  ATL_TOKEN                  Personal Access Token (atl_pat_..., required)
  ATL_BASE_URL               Backend base URL (default: https://app.atimelogger.pro)

Output is always JSON. Read-only: this CLI never starts, stops, or edits
anything — use the MCP server for interactive tracking.
`;

function fail(message: string, code: 1 | 2 = 1): never {
  throw code === 2 ? new UsageError(message) : new Error(message);
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Diagnose a setup without making the caller guess which layer broke: is the
 * token present and shaped right, is the host reachable, does the token still
 * authenticate, and does the account have usable data. Reports rather than
 * throws — a diagnostic that dies on the first problem is not a diagnostic.
 * Never prints the token.
 */
async function doctor(): Promise<{ ok: boolean; base_url: string; node: string; version: string; checks: Check[] }> {
  const [{ normalizeBaseUrl, PAT_PREFIX }, { createApi }, { ApiError }, { NetworkError }] = await Promise.all([
    import("./config.js"),
    import("./client.js"),
    import("./client.js"),
    import("./errors.js"),
  ]);
  const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
  const baseUrl = normalizeBaseUrl(process.env.ATL_BASE_URL);
  const token = process.env.ATL_TOKEN;
  const checks: Check[] = [];

  if (!token) {
    checks.push({
      name: "token",
      ok: false,
      detail: "ATL_TOKEN is not set — generate one in the web app under Settings -> API Tokens, then export it.",
    });
  } else if (!token.startsWith(PAT_PREFIX)) {
    checks.push({
      name: "token",
      ok: true,
      detail: `set (${token.length} chars) but not an ${PAT_PREFIX} token — legacy tokens still work, though they cannot be revoked.`,
    });
  } else {
    checks.push({ name: "token", ok: true, detail: `personal access token, ${token.length} chars.` });
  }

  const describe = (e: unknown): Check => {
    if (e instanceof NetworkError) {
      return { name: "connection", ok: false, detail: `cannot reach ${baseUrl} — ${(e.cause as Error)?.message ?? e.message}` };
    }
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      return { name: "auth", ok: false, detail: `${baseUrl} rejected the token (HTTP ${e.status}) — it may be expired or revoked.` };
    }
    if (e instanceof ApiError) {
      return { name: "auth", ok: false, detail: `${baseUrl} returned HTTP ${e.status}.` };
    }
    return { name: "auth", ok: false, detail: (e as Error).message };
  };

  if (token) {
    const api = createApi({ token, baseUrl });
    try {
      const me = await api.get<{ timeZone?: string }>("/api/users/me");
      checks.push({ name: "connection", ok: true, detail: `reached ${baseUrl}.` });
      checks.push({
        name: "auth",
        ok: true,
        detail: me.timeZone
          ? `token accepted; account timezone ${me.timeZone}.`
          : "token accepted; account has no timezone set, so this machine's is used.",
      });
    } catch (e) {
      checks.push(describe(e));
    }

    if (checks.every((c) => c.ok)) {
      try {
        const types = await api.get<{ deleted: boolean; archived: boolean; group: boolean }[]>("/api/types");
        const usable = types.filter((t) => !t.deleted && !t.archived && !t.group).length;
        checks.push({
          name: "types",
          ok: usable > 0,
          detail: usable > 0
            ? `${usable} activity type(s) available to track.`
            : "no trackable activity types — create one in the app before logging time.",
        });
      } catch (e) {
        checks.push({ ...describe(e), name: "types" });
      }
    }
  }

  return { ok: checks.every((c) => c.ok), base_url: baseUrl, node: process.version, version, checks };
}

async function run(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        period: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        type: { type: "string", multiple: true },
        tag: { type: "string", multiple: true },
        "group-by": { type: "string" },
        page: { type: "string" },
        size: { type: "string" },
        timezone: { type: "string" },
        archived: { type: "boolean" },
        compact: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    fail((e as Error).message, 2);
  }
  const { values, positionals } = parsed;

  if (values.version) {
    const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
    process.stdout.write(version + "\n");
    return;
  }
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  const command = positionals[0];
  if (!command) {
    fail("No command given — run atimelogger-cli --help for usage.", 2);
  }
  if (!["status", "types", "report", "intervals", "doctor"].includes(command)) {
    fail(`Unknown command "${command}" — run atimelogger-cli --help for usage.`, 2);
  }
  if (command === "doctor") {
    const report = await doctor();
    process.stdout.write(JSON.stringify(report, null, values.compact ? undefined : 2) + "\n");
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (!process.env.ATL_TOKEN) {
    fail(
      "ATL_TOKEN is not set — export ATL_TOKEN=atl_pat_... " +
        "(generate a Personal Access Token in the ATimeLogger web app under Settings -> API Tokens).",
      2
    );
  }

  const int = (name: "page" | "size", min: number, max: number): number | undefined => {
    const raw = values[name];
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      fail(`--${name} must be an integer between ${min} and ${max}`, 2);
    }
    return Number(raw);
  };

  const range = {
    // Unvalidated here on purpose: resolveRange rejects unknown words with a
    // UsageError listing the valid ones, which is a better message than ours.
    period: values.period as PeriodWord | undefined,
    from: values.from,
    to: values.to,
    type_names: values.type,
    tags: values.tag,
    timezone: values.timezone,
  };

  let result: unknown;
  switch (command) {
    case "status": {
      const [{ currentStatus }, { effectiveTimezone }] = await Promise.all([
        import("./tools/activities.js"),
        import("./timezone.js"),
      ]);
      result = await currentStatus(await effectiveTimezone(values.timezone));
      break;
    }
    case "types": {
      const { listTypes } = await import("./tools/types.js");
      result = await listTypes(values.archived ?? false);
      break;
    }
    case "report": {
      const groupBy = values["group-by"]?.toUpperCase() as (typeof GROUP_BY)[number] | undefined;
      if (groupBy !== undefined && !GROUP_BY.includes(groupBy)) {
        fail(`--group-by must be ${GROUP_BY.join(", ")}`, 2);
      }
      const { timeReport } = await import("./tools/reports.js");
      result = await timeReport({ ...range, group_by: groupBy });
      break;
    }
    case "intervals": {
      const { listIntervals } = await import("./tools/reports.js");
      result = await listIntervals({ ...range, page: int("page", 0, 100_000), size: int("size", 1, 50) });
      break;
    }
  }

  process.stdout.write(JSON.stringify(result, null, values.compact ? undefined : 2) + "\n");
}

try {
  await run();
} catch (e) {
  // No process.exit(): let stdio flush naturally (async pipe writes on Windows).
  process.stderr.write(JSON.stringify({ error: (e as Error).message }) + "\n");
  process.exitCode = e instanceof UsageError ? 2 : 1;
}
