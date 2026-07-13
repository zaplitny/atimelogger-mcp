# ATimeLogger MCP Server

A standalone MCP (Model Context Protocol) server that exposes the ATimeLogger REST API to Claude Desktop / Claude Code over stdio. Scope: activities (start/stop/pause/log), reports/history, and activity types.

## Setup

Requires Node 20+.

1. Generate a **Personal Access Token** in the ATimeLogger web app: **Settings → API Tokens → Generate token**. The value (starting with `atl_pat_`) is shown **only once** — copy it right away. You can revoke the token from the same page at any time.

2. Build the server and register it:

```bash
npm install
npm run build
npm run setup        # paste the token, verifies it, prints the registration command
```

The setup script prints ready-to-use registration snippets for both clients:

**Claude Code** — a one-liner:

```bash
claude mcp add atl \
  -e ATL_TOKEN=atl_pat_... \
  -- node /absolute/path/to/atl-mcp/dist/index.js
```

**Claude Desktop** — a JSON block to merge into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "atl": {
      "command": "node",
      "args": ["/absolute/path/to/atl-mcp/dist/index.js"],
      "env": {
        "ATL_TOKEN": "atl_pat_..."
      }
    }
  }
}
```

The server targets production (`https://app.atimelogger.pro`) by default — no URL configuration needed. To work against a different backend (e.g. local dev), set `ATL_BASE_URL` explicitly: pass `--url http://localhost:8091` to the setup script (or set the env var), and it will include `ATL_BASE_URL` in the printed snippets. Generate the token in the web UI of the **same** server you point the MCP at.

Troubleshooting: a 401 from any tool means the token is invalid, expired, or was revoked — generate a new one in **Settings → API Tokens** and update `ATL_TOKEN` in the MCP config.

## Tools

| Tool | Purpose |
|---|---|
| `get_current_status` | Running/paused activities with elapsed time |
| `list_activity_types` | Activity type names as a group tree (source of names for other tools) |
| `start_activity` | Start by type name; optional `started_minutes_ago` backdating |
| `stop_activity` | Stop the active activity (name optional if only one is active) |
| `pause_resume_activity` | Pause or resume |
| `log_interval` | Retroactively log a completed entry (wall-clock times, optional comment/tags) |
| `time_report` | Aggregated per-type statistics for a period (`today`, `this_week`, `last_month`, … or explicit dates) |
| `list_intervals` | Raw history grouped by day, paged, max 100-day range |

All tools accept human-readable type names (fuzzy matched) — never UUIDs. Durations are returned as `"2h 15m"` strings; times are shown in the user's ATimeLogger timezone unless a `timezone` parameter is given.

## Manual testing

```bash
ATL_BASE_URL=http://localhost:8091 ATL_TOKEN=<token> \
  npx @modelcontextprotocol/inspector node dist/index.js
```

## Limitations

- `start_activity` cannot attach a comment (the underlying start endpoint takes only a type and time); use `log_interval` for entries with comments/tags.
- No editing of existing entries (the server-side update API is incomplete).
- History requests are capped at 100 days by the backend.
