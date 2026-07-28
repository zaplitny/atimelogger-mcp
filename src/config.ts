export interface Config {
  baseUrl: string;
  token: string | null;
}

export const PAT_PREFIX = "atl_pat_";
export const PROD_URL = "https://app.atimelogger.pro";

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

export function loadConfig(): Config {
  const baseUrl = (process.env.ATL_BASE_URL ?? PROD_URL).replace(/\/+$/, "");
  const token = process.env.ATL_TOKEN ?? null;
  if (!token) {
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
  return { baseUrl, token };
}
