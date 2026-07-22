# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.2]: https://github.com/zaplitny/atimelogger-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/zaplitny/atimelogger-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/zaplitny/atimelogger-mcp/releases/tag/v0.1.0
