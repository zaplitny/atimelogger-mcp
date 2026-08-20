# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-06

### Added

- `atimelogger-cli doctor`: a read-only setup diagnostic that separates a missing token from an unreachable host from a rejected one, reports the resolved base URL and account timezone, exits 1 when unhealthy, and never echoes the token.
- First test suite: 80 `node --test` tests over the pure helpers (duration formatting, DST-correct period math), the API client and type cache, every read and write operation against a mock backend, plus end-to-end runs of both binaries — the CLI's exit-code and JSON contract, and the MCP server driven over stdio. `npm test` builds first and needs no network or token.

- `atimelogger-cli`: minimal read-only JSON CLI installed alongside the MCP server, for scripts and automation ([#3](https://github.com/zaplitny/atimelogger-mcp/issues/3)). Commands `status`, `types`, `report`, `intervals`; JSON on stdout (`--compact` for one line), `{"error"}` on stderr with exit codes 1/2. Reuses the MCP tools' internals (fuzzy type names, period words, timezones); deliberately excludes write operations.
- Write operations on the library client — `start`, `stop`, `pauseResume`, `log`, `update` — extracted from the MCP tool handlers into `ctx`-aware functions. They encode sequencing an embedder should not re-derive: which activity a bare `stop()` means, how backdating maps onto the backend's `?time=`, the exact datetime format the server accepts, and above all `update`'s read-modify-write, since a raw `PUT` soft-deletes every interval missing from the payload. The CLI stays read-only — that restriction was about unattended shell retries, which does not apply to a program holding a client.
- Experimental library entry point: `import { createClient } from "atimelogger-mcp"` exposes the task-shaped core for embedders who want in-process calls rather than a spawned binary ([#3](https://github.com/zaplitny/atimelogger-mcp/issues/3)). `createApi`/`createClient` take an explicit token, base URL, and optional `fetch` override; each client owns its caches, so multiple accounts and fixture-backed tests work in one process. `clientFromEnv()` covers the single-account case, reading `ATL_TOKEN` and `ATL_BASE_URL` together and throwing (never exiting) when the token is missing. Importing the package no longer reads the environment.

### Changed

- Merged `main`'s `app_help` / docs-only work into this branch's refactor: `createTypesCache` and `createTimezone` now build their caches with the shared `ttlCache` helper (one instance per client, so accounts stay isolated), and the environment-driven client keeps docs-only mode by refusing API calls with the setup guidance instead of sending a token-less request. MCP behaviour is unchanged from `main` — verified by diffing 34 tool calls, `app_help` included, plus a full docs-only run, against a build of `main`.
- `config.ts` splits the pure parse (`readEnvConfig`, throws, silent) from the executable UX (`loadConfig`, warns and exits). `clientFromEnv()` uses the former, closing a hazard the merge introduced: `main`'s `loadConfig` exits the process on a stray `ATL_*` variable, which a library must never do to its host.
- `tools/activities.ts` no longer touches the environment-driven singletons at all; every operation takes a context. This closes a latent hazard where a write reached through a library client would have targeted the `ATL_TOKEN` account instead of the client's own credentials.
- `client.ts`, `types-cache.ts`, and `timezone.ts` are now factories (`createApi`, `createTypesCache`, `createTimezone`) with environment-driven default instances built lazily; the MCP server and CLI behave exactly as before.

- Library and CLI results are fully typed and structurally stable: `CurrentStatus` is a discriminated union with an always-present `active` array, `TimeReport` and `IntervalsPage` always carry `by_type`/`periods`/`days` (empty arrays instead of missing keys), durations come with raw `seconds` beside the humanized string, and paging is a `has_more` boolean plus `total_pages`. The token-saving compaction and the LLM-oriented prose stay on the MCP side only, so tool output is unchanged. `ReportArgs.period` is now the `PeriodWord` union, so a typo fails at compile time.
- Error taxonomy: `NetworkError` (request never reached the server, original kept as `.cause`) joins `ApiError` (server answered with a failure, carries `.status`) and `UsageError`, which now also covers unresolvable or ambiguous activity-type names — previously a bare `Error` indistinguishable from a transport failure. The CLI exits 2 for those instead of 1.

### Fixed

- `formatDuration` rounded hours and minutes independently, so 59.5–59.99 minutes rendered as `60m` — a 52h 59.9m total printed as the nonsensical `"52h 60m"`. Minutes are rounded first, then split.
- The resolved profile timezone was cached for the lifetime of the process with no expiry. Harmless for the short-lived MCP server and CLI, but a long-running embedded client would serve a stale timezone until restart; it now refreshes hourly. A *failed* refresh no longer overwrites a timezone that was already resolved — silently shifting day boundaries and the wall-clock times of written intervals — and a lookup that never succeeded is re-tried after a minute instead of being pinned for an hour.
- `npm run build` cleans `dist/` first. Without it, compiled files from unmerged branches lingered and would have been published: the 0.1.2-era tarball layout picked up two orphaned modules.
- Packaging: added the `main` field (without it, bundlers and test runners that ignore `exports` resolved the types but failed at runtime) and switched the export condition from `import` to `default`, so `require()` works on Node ≥22.12 instead of failing with a misleading "no exports main defined".

## [0.1.2] - 2026-07-22

### Changed

- README: the ChatGPT (Developer Mode) section now links the [official guide](https://developers.openai.com/api/docs/guides/developer-mode) instead of hardcoding plan/region specifics, which change over time; noted that a connector set up in the web app also works in the ChatGPT mobile apps.

## [0.1.1] - 2026-07-22

### Added

- `update_activity` tool: change the comment and/or tags of an existing entry (running, paused, or stopped) without touching its tracked time ([#1](https://github.com/zaplitny/atimelogger-mcp/issues/1)). Does a read-modify-write against the backend so intervals and all other fields are preserved.
- `list_intervals` entries now include `activity_id`, so past entries can be targeted by `update_activity`.
- `server.json` manifest; the server is published to the [official MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.zaplitny/atimelogger-mcp`.
- README: setup instructions for OpenAI Codex (CLI / IDE extension) and the ChatGPT web app (Developer Mode custom connector).

### Changed

- Server instructions now steer the assistant to annotate existing entries via `update_activity` instead of logging duplicates.

## [0.1.0] - 2026-07-21

First public release on npm as [`atimelogger-mcp`](https://www.npmjs.com/package/atimelogger-mcp).

### Added

- MCP server (TypeScript, stdio) wrapping the ATimeLogger REST API, authenticated with a Personal Access Token (`ATL_TOKEN`).
- 8 tools: `get_current_status`, `list_activity_types`, `start_activity`, `stop_activity`, `pause_resume_activity`, `log_interval`, `time_report`, `list_intervals`.
- Fuzzy activity-type name resolution (exact, then substring) with helpful errors on ambiguity; internal UUIDs flow between tools but are kept hidden from the user.
- Backdating: `start_activity`/`stop_activity` accept `at` (wall-clock) or `*_minutes_ago`; `log_interval` records completed entries retroactively with optional comment/tags.
- Period words (`today` … `last_30_days`) with DST-correct wall-clock↔UTC conversion and Monday-start weeks, zero-dep via `Intl`.
- `npm run setup` script: verifies a pasted token and prints ready-to-use registration snippets.
- npm packaging (`npx atimelogger-mcp`) and README guides for Claude Code, Claude Desktop, and a self-hosted remote endpoint (Custom Connector) behind Docker + nginx.

[0.2.0]: https://github.com/zaplitny/atimelogger-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/zaplitny/atimelogger-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/zaplitny/atimelogger-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/zaplitny/atimelogger-mcp/releases/tag/v0.1.0
