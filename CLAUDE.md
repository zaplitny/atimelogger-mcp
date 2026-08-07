# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

`atimelogger-mcp` — a standalone MCP (Model Context Protocol) server, TypeScript over stdio, that wraps the ATimeLogger REST API for use from Claude Desktop / Claude Code. It exposes 10 tools: `get_current_status`, `list_activity_types`, `start_activity`, `stop_activity`, `pause_resume_activity`, `log_interval`, `update_activity`, `time_report`, `list_intervals`, `app_help`.

The backend is a separate, private Spring Boot app; this repo never modifies it — it is a pure API client.

## Commands

```bash
npm install
npm run build        # tsc → dist/
npm run dev          # run from source via tsx
npm run setup        # paste a Personal Access Token, verify it, print the `claude mcp add` command
npm test             # builds, then node --test over test/ — mock-backed, no network or token

# Manual tool testing:
ATL_BASE_URL=... ATL_TOKEN=... npx @modelcontextprotocol/inspector node dist/index.js
```

Node 20+, ESM, zero runtime deps beyond `@modelcontextprotocol/sdk` and `zod`.

## Architecture

- `src/index.ts` — entry: McpServer + StdioServerTransport, registers tool groups; declares server-level `instructions` (project overview + cross-tool conventions) surfaced to the LLM at initialize
- `src/config.ts` — env (all parsing lives here). `readEnvConfig()` is the pure parse: throws on a botched setup, never writes to stderr, never exits — the library path needs both. `loadConfig()` wraps it with the executable-facing UX (warn, exit) and memoizes. Vars: `ATL_BASE_URL` (default `https://app.atimelogger.pro`, i.e. production), `ATL_DOCS_URL` (default `https://atimelogger.pro/docs/`), `ATL_TOKEN` (optional: absent → docs-only mode, stderr warning at startup and only `app_help` works — API tools throw setup instructions from client.ts; set-but-empty or stray unrecognized `ATL_*` vars → fail fast, that's a botched config, not docs-only intent; warns if the token isn't an `atl_pat_` token)
- `src/client.ts` — `createApi({token, baseUrl?, fetch?})` builds a client from explicit credentials (no env access); bearer auth, error normalization (401 → regenerate-PAT guidance, transport failure → `NetworkError` with `cause`). The exported `api` is a lazily-built env-driven default that, in docs-only mode, refuses every call with the setup guidance instead of sending a token-less request.
- `src/types-cache.ts` — `/api/types` cached 60s; fuzzy type-name resolution (exact → substring; ambiguity/no-match → helpful errors). Groups excluded as start/log targets, allowed in report filters.
- `src/timezone.ts` — default tz from `/api/users/me`, per-call override
- `src/periods.ts` — period words (`today`…`last_30_days`) → date ranges; DST-correct wall-clock↔UTC conversion; Monday-start weeks; zero-dep (Intl)
- `src/format.ts` — duration formatting ("2h 15m"), `compact()` null-stripping
- `src/errors.ts` — `withErrors()` wrapper: tool handlers never throw, return `isError`
- `src/tools/{types,activities,reports}.ts` — tool definitions (zod schemas) plus the transport-independent operations behind them (`currentStatus`, `listTypes`, `timeReport`, `listIntervals`, `startActivity`, `stopActivity`, `pauseResumeActivity`, `logInterval`, `updateActivity`), each taking an optional trailing `Ctx`. MCP-only presentation (token-saving `compact()`, LLM-oriented prose) lives in per-file `*ForMcp` mappers, so library and CLI consumers get stable typed shapes while tool output is unchanged.
- `src/tools/docs.ts` — `app_help`: fetches the official docs site (config `docsUrl`, unauthenticated, separate host from the API). No args → TOC from `help-index.json` (slug/title/summary per page plus a platform `note`, hand-maintained in the atimelogger-docs repo alongside the markdown sources, which the docs deploy copies into `site/`); `topics` → fetches `<slug>.md` pages (fuzzy slug/title match, deduped), strips `<figure>` blocks and `&#x20;`. Non-JSON/shape-invalid manifest → the same "docs unavailable" guidance as network errors. Cached 1h with stale-on-error fallback. Not part of the library entry — it is account-independent and reads env at import.
- `src/ttl-cache.ts` — shared `ttlCache`/`ttlCacheBy` helpers (single-value and keyed), opt-in `staleOnError`. Used by docs.ts, and by `createTypesCache`/`createTimezone`, which build one cache instance per client so accounts stay isolated. `staleOnError` is on for timezone (a failed refresh must not clobber a resolved zone) and deliberately off for types (auth/API errors must surface).
- `src/core.ts` — public library entry (`createClient`, `clientFromEnv`, `createApi`); `src/context.ts` — `Ctx` bundling api + per-client caches, with a lazily-built env-driven default so importing the package never reads env or exits
- `test/` — `node --test` suite over a mock backend (`test/helpers.mjs` builds a `Ctx` from a route map); includes end-to-end runs of both binaries
- `scripts/setup.ts` — prompts for a pasted PAT, verifies it against `/api/users/me`, prints the ready `claude mcp add` command

Design rule: tools are task-shaped, not 1:1 REST mirrors. Names for humans, UUIDs for machines: tools accept human type **names** (fuzzy resolved) and outputs carry internal `id` fields that tools also accept back (`type_id`, `activity_id`, `type_ids`) for exact targeting between calls — the server instructions tell the LLM to never show ids to the user. Responses are compact JSON with resolved names and humanized durations.

## Backend API contract (verified against the Java source, 2026-07)

- **Auth**: Personal Access Tokens (`atl_pat_` + 43 chars base64url), generated in the web app Settings → API Tokens, shown once, revocable, optional expiry (default 90 days). Sent as `Authorization: Bearer <token>` on all `/api/**` calls; the backend resolves the user/tenant from a SHA-256 hash lookup. Legacy 365-day JWTs (`POST /auth/jwt`) still work but can't be revoked. PAT-authenticated requests get 403 on `/api/tokens/**` (tokens are managed only from a web session). No tenant/device headers.
- **Datetime format (critical)**: the backend's Jackson config (`JacksonConfiguration`) requires `LocalDateTime` exactly as `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` (UTC) — i.e. JS `Date.toISOString()`. Dates are plain `yyyy-MM-dd`.
- **Retroactive logging**: `POST /api/activities` body `{typeId, status:"STOPPED", comment, tags, intervals:[{start,finish}]}`; validation requires non-empty `intervals`, top-level `start` null, non-group `typeId`. Interval unix `from`/`to` fields are **ignored on write** (mapper), only `start`/`finish` count.
- **Timer ops**: `POST /api/activities/{start|stop|pause|resume}/{id}?time=<unixSec>`, `time=0` means "now" server-side (used for backdating).
- **Current activities**: `GET /api/activities` → `{activities, types}`; filter client-side by `status` RUNNING/PAUSED.
- **Statistics**: `POST /api/statistics` `{types?, tags?, from, to, timezone?, groupBy: DAY|WEEK|MONTH}` → pre-aggregated, durations in seconds, `groupedStatistics` is a recursive type hierarchy.
- **History**: `POST /api/intervals?page&size` (Spring `Page` of day groups, server default size 5) body `{types?, tags?, from, to, timezone}`; **max 100-day range** (server rejects beyond).
- **Update (comment/tags)**: `GET /api/activities/{id}` returns the full ActivityDto (intervals carry both `start`/`finish` and `from`/`to`); `PUT /api/activities/{id}` replaces the whole record via a server-side merge (`ActivityService.merge`, integration-tested): tags/intervals are matched by id, and **any interval missing from the payload is soft-deleted** — so `update_activity` does read-modify-write, round-tripping the GET response verbatim and touching only `comment`/`tags`. The PUT reads only interval `start`/`finish` (never `from`/`to`), returns an empty body, and validation requires: stopped/paused ⇒ top-level `start` null + non-empty intervals; running ⇒ `start` set. (A stale `// todo` above the backend merge code once suggested it was unfinished — it is implemented and tested, verified 2026-07.)
- **Server-side quirks**: the start endpoint cannot attach a comment; activity update does not push a realtime event (other devices see it on next sync).

## Roadmap / known TODOs

- npm packaging is ready (shebang, `bin`, `files: ["dist"]`, `prepack` build, MIT LICENSE, `mcpName` for the MCP registry) — first `npm publish` still pending.
- Distribution tiers discussed: npm package (prepared, see above) → official MCP Registry (`mcp-publisher`, needs the npm publish first) → MCPB (`.mcpb`) one-click bundle for Claude Desktop (PAT generation in Settings → API Tokens now covers the token-UX prerequisite) → hosted remote MCP server with OAuth 2.1 (would live in the backend as Spring AI MCP, not here).
- Backend prerequisites for public distribution: API-scoped tokens (PATs are revocable but still full-access).
