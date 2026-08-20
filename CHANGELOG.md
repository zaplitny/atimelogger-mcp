# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-20

### Added

- `app_help` tool: answers questions about the app itself (goals, widgets, sync, export, editing entries) from the [official documentation](https://atimelogger.pro/docs/). No arguments returns the table of contents; `topics` fetches matching pages. Cached an hour, with the last good copy served if the docs site is unreachable.
- Docs-only mode: `ATL_TOKEN` is now optional. Without it the server starts and `app_help` works; the time-tracking tools return setup instructions when called.
- `atimelogger-cli`: read-only JSON CLI installed alongside the MCP server, for scripts and automation ([#3](https://github.com/zaplitny/atimelogger-mcp/issues/3)). Commands `status`, `types`, `report`, `intervals`; JSON on stdout (`--compact` for one line), `{"error"}` on stderr with exit codes 1/2.
- `atimelogger-cli doctor`: setup diagnostic that separates a missing token from an unreachable host from a rejected one. Exits 1 when unhealthy, never echoes the token.
- Experimental library entry point: `import { createClient } from "atimelogger-mcp"` for in-process use instead of spawning a binary ([#3](https://github.com/zaplitny/atimelogger-mcp/issues/3)). Reads (`status`, `report`, `intervals`, `types`) and writes (`start`, `stop`, `pauseResume`, `log`, `update`); explicit token and base URL, optional `fetch` override, one cache set per client. `clientFromEnv()` covers the single-account case. Importing the package no longer reads the environment.
- First test suite: 105 `node --test` tests over helpers, client, caches, and every operation against a mock backend, plus end-to-end runs of both binaries. `npm test` needs no network or token.

### Changed

- Library and CLI results are fully typed and structurally stable: `by_type`/`periods`/`days`/`active` are always present (empty arrays, not missing keys), durations carry raw `seconds` beside the humanized string, paging is a `has_more` boolean. MCP tool output is unchanged.
- Error taxonomy: `NetworkError` (request never reached the server) and `UsageError` (bad arguments, unresolvable or ambiguous type name) join `ApiError` (carries `.status`). The CLI exits 2 for usage errors instead of 1.
- `client.ts`, `types-cache.ts`, and `timezone.ts` are now factories with lazily-built environment-driven defaults; caches are per client, so multiple accounts stay isolated.
- `config.ts` splits the pure parse (`readEnvConfig`, throws) from the executable UX (`loadConfig`, warns and exits) — a library must not exit its host process.

### Fixed

- `formatDuration` rounded hours and minutes independently, so 52h 59.9m printed as `"52h 60m"`. Minutes are rounded first, then split.
- The profile timezone was cached for the lifetime of the process; it now refreshes hourly, and a failed refresh no longer clobbers an already-resolved zone.
- `npm run build` cleans `dist/` first — stale files from other branches were otherwise published (the 0.1.2 tarball picked up two orphaned modules).
- Packaging: added the `main` field and switched the export condition from `import` to `default`, so `require()` works on Node ≥22.12.

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
