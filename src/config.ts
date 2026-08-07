import { UsageError } from "./errors.js";

export interface Config {
  baseUrl: string;
  docsUrl: string;
  token: string | null;
}

export const PAT_PREFIX = "atl_pat_";
export const PROD_URL = "https://app.atimelogger.pro";
export const DOCS_URL = "https://atimelogger.pro/docs/";

const KNOWN_ENV = new Set(["ATL_TOKEN", "ATL_BASE_URL", "ATL_DOCS_URL"]);

/** The one base-URL rule: default to production, strip trailing slashes. */
export function normalizeBaseUrl(raw: string | undefined): string {
  return (raw ?? PROD_URL).replace(/\/+$/, "");
}

export function setupInstructions(baseUrl: string): string {
  const baseUrlArg = baseUrl === PROD_URL ? "" : `-e ATL_BASE_URL=${baseUrl} `;
  return (
    "Create a Personal Access Token in the ATimeLogger web app:\n" +
    "  Settings -> API Tokens -> Generate token  (the value is shown only once)\n" +
    "Then register the server with:\n" +
    "  claude mcp add atimelogger " +
    baseUrlArg +
    "-e ATL_TOKEN=atl_pat_... -- npx -y atimelogger-mcp\n" +
    "(from a source checkout, run `npm run setup` to paste the token interactively)"
  );
}

/**
 * Parse the ATL_* environment into a Config.
 *
 * Pure with respect to the process: throws on a botched configuration, never
 * writes to stderr and never exits. The library entry point needs both
 * guarantees — a dependency must not kill or spam its host. `loadConfig()`
 * layers the executable-facing UX on top.
 */
export function readEnvConfig(): Config {
  const baseUrl = normalizeBaseUrl(process.env.ATL_BASE_URL);
  const docsUrl = (process.env.ATL_DOCS_URL ?? DOCS_URL).replace(/\/+$/, "") + "/";
  const token = process.env.ATL_TOKEN || null;
  if (!token) {
    // Distinguish deliberate docs-only mode (no token config at all) from a
    // botched configuration attempt — the latter is an error, not a mode.
    const strays = Object.keys(process.env).filter((k) => k.startsWith("ATL_") && !KNOWN_ENV.has(k));
    if (process.env.ATL_TOKEN !== undefined) {
      throw new UsageError("ATL_TOKEN is set but empty.");
    }
    if (strays.length > 0) {
      throw new UsageError(
        `ATL_TOKEN is not set, but unrecognized ATL_* variables are: ${strays.join(", ")} — a typo'd name?`
      );
    }
  }
  return { baseUrl, docsUrl, token };
}

let config: Config | null = null;

/** Config for the executables (MCP server, CLI): warns on stderr, exits on a botched setup. */
export function loadConfig(): Config {
  if (config) return config;
  let parsed: Config;
  try {
    parsed = readEnvConfig();
  } catch (e) {
    const baseUrl = normalizeBaseUrl(process.env.ATL_BASE_URL);
    process.stderr.write((e as Error).message + "\n" + setupInstructions(baseUrl) + "\n");
    process.exit(1);
  }
  if (!parsed.token) {
    // Docs-only mode: app_help works without auth; API-backed tools error on use (client.ts).
    process.stderr.write(
      "ATL_TOKEN is not set — running in docs-only mode (only app_help will work).\n" +
        setupInstructions(parsed.baseUrl) +
        "\n"
    );
  } else if (!parsed.token.startsWith(PAT_PREFIX)) {
    // Legacy 365-day JWTs still work server-side, but can't be revoked.
    process.stderr.write(
      "ATL_TOKEN does not look like a personal access token (atl_pat_...) — " +
        "consider generating one in the web app under Settings -> API Tokens.\n"
    );
  }
  config = parsed;
  return config;
}
