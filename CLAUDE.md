# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

`atl-mcp` — a standalone MCP (Model Context Protocol) server, TypeScript over stdio, that wraps the ATimeLogger REST API for use from Claude Desktop / Claude Code. It exposes 8 tools: `get_current_status`, `list_activity_types`, `start_activity`, `stop_activity`, `pause_resume_activity`, `log_interval`, `time_report`, `list_intervals`.

The backend is a separate Spring Boot app (source at `~/Projects/atl` on this machine); this repo never modifies it — it is a pure API client.

## Commands

```bash
npm install
npm run build        # tsc → dist/
npm run dev          # run from source via tsx
npm run setup        # paste a Personal Access Token, verify it, print the `claude mcp add` command

# Manual tool testing:
ATL_BASE_URL=... ATL_TOKEN=... npx @modelcontextprotocol/inspector node dist/index.js
```

No test suite yet. Node 20+, ESM, zero runtime deps beyond `@modelcontextprotocol/sdk` and `zod`.

## Architecture

- `src/index.ts` — entry: McpServer + StdioServerTransport, registers tool groups; declares server-level `instructions` (project overview + cross-tool conventions) surfaced to the LLM at initialize
- `src/config.ts` — env: `ATL_BASE_URL` (default `https://app.atimelogger.pro`, i.e. production), `ATL_TOKEN` (required, fail fast; warns if it isn't an `atl_pat_` token)
- `src/client.ts` — fetch wrapper: bearer auth, error normalization (401 → regenerate-PAT guidance)
- `src/types-cache.ts` — `/api/types` cached 60s; fuzzy type-name resolution (exact → substring; ambiguity/no-match → helpful errors). Groups excluded as start/log targets, allowed in report filters.
- `src/timezone.ts` — default tz from `/api/users/me`, per-call override
- `src/periods.ts` — period words (`today`…`last_30_days`) → date ranges; DST-correct wall-clock↔UTC conversion; Monday-start weeks; zero-dep (Intl)
- `src/format.ts` — duration formatting ("2h 15m"), `compact()` null-stripping
- `src/errors.ts` — `withErrors()` wrapper: tool handlers never throw, return `isError`
- `src/tools/{types,activities,reports}.ts` — tool definitions (zod schemas)
- `scripts/setup.ts` — prompts for a pasted PAT, verifies it against `/api/users/me`, prints the ready `claude mcp add` command

Design rule: tools are task-shaped, not 1:1 REST mirrors. Tools accept human type **names** (fuzzy resolved), never UUIDs; responses are compact JSON with resolved names and humanized durations.

## Backend API contract (verified against the Java source, 2026-07)

- **Auth**: Personal Access Tokens (`atl_pat_` + 43 chars base64url), generated in the web app Settings → API Tokens, shown once, revocable, optional expiry (default 90 days). Sent as `Authorization: Bearer <token>` on all `/api/**` calls; the backend resolves the user/tenant from a SHA-256 hash lookup. Legacy 365-day JWTs (`POST /auth/jwt`) still work but can't be revoked. PAT-authenticated requests get 403 on `/api/tokens/**` (tokens are managed only from a web session). No tenant/device headers.
- **Datetime format (critical)**: the backend's Jackson config (`JacksonConfiguration`) requires `LocalDateTime` exactly as `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` (UTC) — i.e. JS `Date.toISOString()`. Dates are plain `yyyy-MM-dd`.
- **Retroactive logging**: `POST /api/activities` body `{typeId, status:"STOPPED", comment, tags, intervals:[{start,finish}]}`; validation requires non-empty `intervals`, top-level `start` null, non-group `typeId`. Interval unix `from`/`to` fields are **ignored on write** (mapper), only `start`/`finish` count.
- **Timer ops**: `POST /api/activities/{start|stop|pause|resume}/{id}?time=<unixSec>`, `time=0` means "now" server-side (used for backdating).
- **Current activities**: `GET /api/activities` → `{activities, types}`; filter client-side by `status` RUNNING/PAUSED.
- **Statistics**: `POST /api/statistics` `{types?, tags?, from, to, timezone?, groupBy: DAY|WEEK|MONTH}` → pre-aggregated, durations in seconds, `groupedStatistics` is a recursive type hierarchy.
- **History**: `POST /api/intervals?page&size` (Spring `Page` of day groups, server default size 5) body `{types?, tags?, from, to, timezone}`; **max 100-day range** (server rejects beyond).
- **Server-side quirks**: `PUT /api/activities/{id}` interval merging is an unfinished TODO in the backend — do not build an edit-activity tool on it; the start endpoint cannot attach a comment.
- Ports: local dev 8091, prod 8090, no context path.

## Roadmap / known TODOs

- Add `#!/usr/bin/env node` shebang to `src/index.ts` (required before the `bin` entry / npx works) before distributing. (Default `ATL_BASE_URL` already points to prod.)
- Distribution tiers discussed: npm package → MCPB (`.mcpb`) one-click bundle for Claude Desktop (PAT generation in Settings → API Tokens now covers the token-UX prerequisite) → hosted remote MCP server with OAuth 2.1 (would live in the backend as Spring AI MCP, not here).
- Backend prerequisites for public distribution: API-scoped tokens (PATs are revocable but still full-access).
