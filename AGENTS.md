# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node 20+ TypeScript ESM MCP server for the ATimeLogger REST API. Source files live in `src/`. It exposes 12 tools: `get_current_status`, `list_activity_types`, `start_activity`, `stop_activity`, `pause_resume_activity`, `log_interval`, `update_activity`, `update_interval`, `archive_activity_type`, `time_report`, `list_intervals` and `app_help`. The entry point is `src/index.ts`, which serves over stdio the MCP server that `src/server.ts` builds: its instructions and the tool groups from `src/tools/activities.ts`, `src/tools/reports.ts`, `src/tools/types.ts` and `src/tools/docs.ts`. Shared API, formatting, timezone, period, and error helpers are in top-level `src/*.ts` files. `scripts/setup.ts` verifies a Personal Access Token and prints MCP registration snippets. Build output goes to `dist/` and should not be edited by hand.

## Build, Test, and Development Commands

- `npm install` installs runtime and development dependencies.
- `npm run build` runs `tsc` and emits compiled files into `dist/`.
- `npm run dev` runs the server from `src/index.ts` through `tsx`.
- `npm run setup` prompts for an ATimeLogger PAT, verifies it, and prints Claude registration config.
- `ATL_BASE_URL=... ATL_TOKEN=... npx @modelcontextprotocol/inspector node dist/index.js` manually exercises the built MCP server.

## Coding Style & Naming Conventions

Use strict TypeScript with ESM imports. Keep `.js` extensions in relative imports because the project uses `moduleResolution: "NodeNext"`. Follow the existing style: two-space indentation, double quotes, semicolons, small helper functions, and compact JSON responses. Prefer task-shaped MCP tools over direct REST mirrors. Tools accept human-readable activity type names, not UUIDs.

## Testing Guidelines

`npm test` builds and runs the `node --test` suite in `test/` against a mock backend, with no network or token. Before submitting changes, run it. For behavior changes, manually test with the MCP inspector against a local or production-compatible backend using `ATL_TOKEN` and, when needed, `ATL_BASE_URL`. If adding tests, place them near the relevant module or in a clearly named test directory, and name files after the unit under test, for example `periods.test.ts`.

## Commit & Pull Request Guidelines

The current history has a single descriptive commit, so no strict convention is established. Use short, imperative or descriptive subjects such as `Add interval pagination handling`. Pull requests should explain the user-facing MCP behavior changed, list manual verification commands, and note any backend API assumptions. Include screenshots only when changing setup instructions or client-visible registration output.

## Security & Configuration Tips

Do not commit real `ATL_TOKEN` values or generated Claude config containing tokens. Production defaults to `https://app.atimelogger.pro`; use `ATL_BASE_URL` only for non-production backends.
