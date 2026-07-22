# ATimeLogger MCP Server

A standalone MCP (Model Context Protocol) server that exposes the ATimeLogger REST API to AI assistants — locally over stdio (Claude Desktop / Claude Code / OpenAI Codex) or remotely as a connector (claude.ai in the browser, Claude mobile apps, ChatGPT). Scope: activities (start/stop/pause/log), reports/history, and activity types.

## Setup

Requires Node 20+.

1. Generate a **Personal Access Token** in the ATimeLogger web app: **Settings → API Tokens → Generate token**. The value (starting with `atl_pat_`) is shown **only once** — copy it right away. You can revoke the token from the same page at any time.

2. Register the server. No install or build step needed — `npx` fetches the [published package](https://www.npmjs.com/package/atimelogger-mcp) on first run:

**Claude Code** — a one-liner:

```bash
claude mcp add atimelogger \
  -e ATL_TOKEN=atl_pat_... \
  -- npx -y atimelogger-mcp
```

**Claude Desktop** — a JSON block to merge into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "atimelogger": {
      "command": "npx",
      "args": ["-y", "atimelogger-mcp"],
      "env": {
        "ATL_TOKEN": "atl_pat_..."
      }
    }
  }
}
```

**OpenAI Codex** (CLI, IDE extension, or the ChatGPT desktop app's Codex mode) — also a one-liner; the configuration is shared by all three Codex surfaces:

```bash
codex mcp add atimelogger --env ATL_TOKEN=atl_pat_... -- npx -y atimelogger-mcp
```

Equivalent `~/.codex/config.toml` block:

```toml
[mcp_servers.atimelogger]
command = "npx"
args = ["-y", "atimelogger-mcp"]
env = { "ATL_TOKEN" = "atl_pat_..." }
```

MCP support in Codex is not gated by plan — it works with any ChatGPT subscription that includes Codex, or with a plain API key. (Using the tools from the ChatGPT **web/mobile** app is a different path — see **Connect from ChatGPT** below.)

### Running from source

Instead of the published package, you can clone and build:

```bash
git clone https://github.com/zaplitny/atimelogger-mcp && cd atimelogger-mcp
npm install
npm run build
npm run setup        # paste the token, verifies it, prints registration snippets pointing at the local build
```

Troubleshooting: a 401 from any tool means the token is invalid, expired, or was revoked — generate a new one in **Settings → API Tokens** and update `ATL_TOKEN` in the MCP config.

## Tools

| Tool | Purpose |
|---|---|
| `get_current_status` | Running/paused activities with elapsed time |
| `list_activity_types` | Activity type names as a group tree (source of names for other tools) |
| `start_activity` | Start by type name; optional backdating (`at` wall-clock time or `started_minutes_ago`) |
| `stop_activity` | Stop the active activity (name optional if only one is active); same backdating options |
| `pause_resume_activity` | Pause or resume |
| `log_interval` | Retroactively log a completed entry (wall-clock times, optional comment/tags) |
| `update_activity` | Change the comment/tags of an existing entry (running or past) without touching its times |
| `time_report` | Aggregated per-type statistics for a period (`today`, `this_week`, `last_month`, … or explicit dates) |
| `list_intervals` | Raw history grouped by day, paged, max 100-day range |

Tools accept human-readable type names (fuzzy matched); internal ids also flow through tool outputs and parameters for exact targeting, but are never shown to the user. Durations are returned as `"2h 15m"` strings; times are shown in the user's ATimeLogger timezone unless a `timezone` parameter is given.

## Usage examples

Things you can say to your assistant once the server is registered:

**Timers**

> "Start tracking work" · "Stop the timer" · "Pause reading, I'll be back in 10" · "What am I tracking right now?"

**Backdating** — forgot to press start or stop:

> "Start Development — I actually began at 11:30" · "Stop work, I finished 20 minutes ago" · "I've been in a meeting since 14:00, track it"

**Logging past activities**

> "Log 2 hours of Reading yesterday from 9 to 11pm" · "Add a gym session for last Saturday morning, 90 minutes, tag it 'legs'" · "I slept from 23:30 to 7:15, log it"

**Annotating existing entries**

> "Add a note to the current timer: reviewing the Q3 report" · "Tag this morning's Work session with 'client-x'" · "Update yesterday's meeting entry — it was the architecture sync"

**Reports & history**

> "Where did my week go?" · "How much did I work in June, broken down by week?" · "Compare my sleep this month vs last month" · "Show everything I tracked today" · "Which day last week had the most Development time?"

**Combinations** — the assistant chains tools on its own:

> "Stop whatever is running and start Work" · "Continue from where the last entry ended — start Development from that time" · "Fill yesterday's gap between lunch and the meeting with Reading"

Activity names are fuzzy-matched against your own type list, so "start dev" finds "Development"; the assistant asks when a name is ambiguous.

## Remote server (Custom Connector)

Besides the local stdio setup above, the server can run as a **remote MCP server** and connect to Claude as a **Custom Connector** — or to ChatGPT via **Developer Mode** (section C). This is the path to use if you want to reach your ATimeLogger data from **claude.ai in the browser, the Claude mobile apps, or the ChatGPT web/mobile apps**, where local stdio servers aren't available.

There are two audiences here: people who just want to **connect** to a running endpoint, and people who want to **self-host** their own.

### A. Connect to a remote endpoint

If you have the HTTPS URL of a running instance (for example one you host yourself, per section B):

1. Open **claude.ai** in a browser (desktop or mobile). The one-time "add" step is done in the web UI; once added it also shows up in the mobile apps.
2. Go to **Settings → Connectors → Add custom connector**.
3. Enter a name (e.g. `ATimeLogger`) and the server URL, ending in `/mcp`:
   ```
   https://your-host.example.com/mcp
   ```
4. Click **Add**.
5. In any chat, open the **+** menu → **Connectors** and toggle the connector on.

Then talk to Claude as usual — "what am I tracking right now?", "where did my week go?", etc. (see **Usage examples**). On mobile it works the same way once the connector is enabled for the conversation.

> **Note on how Claude reaches your server.** Custom connectors connect **from Anthropic's cloud infrastructure**, not from your own device — this is true even in the mobile apps and Claude Desktop. Your endpoint must be reachable over the public internet. A server on `localhost`, behind a VPN, or blocked by a firewall won't connect even though you can reach it from your own machine.

### B. Self-host the remote endpoint

The server speaks **stdio**, so to expose it over HTTPS you put a small proxy in front that serves it over **Streamable HTTP**, then terminate TLS with a reverse proxy. One working setup:

**1. Run the server behind an HTTP proxy, in Docker.** The host only needs Docker — no source checkout, no Node install. The image pulls the [published npm package](https://www.npmjs.com/package/atimelogger-mcp) plus [`mcp-proxy`](https://www.npmjs.com/package/mcp-proxy), which serves the stdio server over Streamable HTTP:

```dockerfile
FROM node:22-slim
RUN npm i -g atimelogger-mcp mcp-proxy
EXPOSE 8080
CMD ["mcp-proxy", "--port", "8080", "--", "atimelogger-mcp"]
```

Pin a version (`npm i -g atimelogger-mcp@0.1.0`) if you want reproducible rebuilds; to upgrade later, rebuild with `--no-cache` (or bump the pin) and recreate the container.

Build and run it, bound to **localhost only**, with your token passed as an env var:

```bash
docker build -t atimelogger-mcp .
docker run -d --name atimelogger-mcp \
  -p 127.0.0.1:9095:8080 \
  --restart unless-stopped \
  -e ATL_TOKEN=atl_pat_your_token_here \
  atimelogger-mcp
```

Verify it's up locally (a bare `GET` returns **400 Bad Request** — that's expected, it means the endpoint is listening and refusing an incomplete handshake):

```bash
curl -i http://127.0.0.1:9095/mcp
```

**2. Put a TLS reverse proxy in front.** Example nginx location block inside your HTTPS server block. The streaming directives (`proxy_buffering off`, long `proxy_read_timeout`) matter — without them the connection stalls:

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:9095/mcp;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # streaming essentials
    proxy_set_header Connection '';
    proxy_buffering  off;
    proxy_cache      off;
    proxy_read_timeout  3600s;
    chunked_transfer_encoding on;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Your public endpoint is now `https://your-host.example.com/mcp` — add it as a Custom Connector per section A.

**3. Test before wiring up Claude (optional).** The MCP Inspector confirms the endpoint independently:

```bash
npx @modelcontextprotocol/inspector
```

Set transport type to **Streamable HTTP**, enter the URL, and check that the handshake succeeds and the tool list appears.

> **Security — read before exposing this.** The remote server is authenticated by the single `ATL_TOKEN` baked into the container, so **anyone who can reach the URL acts as you** against your ATimeLogger account. There is no per-user login at the MCP layer. If you self-host:
> - Keep the endpoint private (don't publish the URL), or put an auth check in front of it (e.g. a required header or basic auth in nginx).
> - Only bind the container to `127.0.0.1` (as above) so the raw HTTP port is never exposed directly — nginx stays the only public door.
> - Treat the token like a password; rotate it from **Settings → API Tokens** if it's ever exposed.

### C. Connect from ChatGPT (Developer Mode)

The same remote endpoint works in the ChatGPT web app as a custom MCP app via **Developer Mode** (paid plans). The exact settings location and flow change from time to time — follow the official guide: <https://developers.openai.com/api/docs/guides/developer-mode>. In short:

1. Enable **Developer mode** in ChatGPT settings (see the guide for where it currently lives).
2. Create a new app/connector for the server URL ending in `/mcp`, with authentication set to **None** (the ATimeLogger token lives server-side; see the security note above).
3. Enable it in a chat, then talk as usual — "what am I tracking right now?", "log 2 hours of reading yesterday 9 to 11pm".

Notes:

- Set it up once in the **web** app; after that the connector also works in the ChatGPT **mobile** apps.
- ChatGPT connects **from OpenAI's infrastructure**, so the endpoint must be publicly reachable — same rule as for Claude custom connectors.
- Write actions (starting/stopping timers, logging entries) ask for confirmation in ChatGPT before running by default.
- Plan, region, and feature limitations may apply and change over time — check the official documentation for the current state. (Don't confuse Developer Mode with ChatGPT's `search`/`fetch`-only connectors for Deep Research — this server exposes action tools, so Developer Mode is the path that works.)

## Limitations

- `start_activity` cannot attach a comment (the underlying start endpoint takes only a type and time); add one afterwards with `update_activity`, or use `log_interval` for retroactive entries with comments/tags.
- Only comments and tags of existing entries can be edited (`update_activity`); interval times cannot be changed and entries cannot be deleted — use the ATimeLogger app for that.
- History requests are capped at 100 days by the backend.
