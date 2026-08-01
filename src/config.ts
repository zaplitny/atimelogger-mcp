export interface Config {
  baseUrl: string;
  docsUrl: string;
  token: string | null;
}

export const PAT_PREFIX = "atl_pat_";
export const PROD_URL = "https://app.atimelogger.pro";
export const DOCS_URL = "https://atimelogger.pro/docs/";

const KNOWN_ENV = new Set(["ATL_TOKEN", "ATL_BASE_URL", "ATL_DOCS_URL"]);

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

let config: Config | null = null;

export function loadConfig(): Config {
  if (config) return config;
  const baseUrl = (process.env.ATL_BASE_URL ?? PROD_URL).replace(/\/+$/, "");
  const docsUrl = (process.env.ATL_DOCS_URL ?? DOCS_URL).replace(/\/+$/, "") + "/";
  const token = process.env.ATL_TOKEN || null;
  if (!token) {
    // Distinguish deliberate docs-only mode (no token config at all) from a botched
    // configuration attempt — fail fast on the latter.
    const strays = Object.keys(process.env).filter((k) => k.startsWith("ATL_") && !KNOWN_ENV.has(k));
    if (process.env.ATL_TOKEN !== undefined || strays.length > 0) {
      const reason =
        process.env.ATL_TOKEN !== undefined
          ? "ATL_TOKEN is set but empty."
          : `ATL_TOKEN is not set, but unrecognized ATL_* variables are: ${strays.join(", ")} — a typo'd name?`;
      process.stderr.write(reason + "\n" + setupInstructions(baseUrl) + "\n");
      process.exit(1);
    }
    // Docs-only mode: app_help works without auth; API-backed tools error on use (client.ts).
    process.stderr.write(
      "ATL_TOKEN is not set — running in docs-only mode (only app_help will work).\n" +
        setupInstructions(baseUrl) +
        "\n"
    );
  } else if (!token.startsWith(PAT_PREFIX)) {
    // Legacy 365-day JWTs still work server-side, but can't be revoked.
    process.stderr.write(
      "ATL_TOKEN does not look like a personal access token (atl_pat_...) — " +
        "consider generating one in the web app under Settings -> API Tokens.\n"
    );
  }
  config = { baseUrl, docsUrl, token };
  return config;
}
