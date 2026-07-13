export interface Config {
  baseUrl: string;
  token: string;
}

export const PAT_PREFIX = "atl_pat_";
export const PROD_URL = "https://app.atimelogger.pro";

export function loadConfig(): Config {
  const baseUrl = (process.env.ATL_BASE_URL ?? PROD_URL).replace(/\/+$/, "");
  const token = process.env.ATL_TOKEN;
  if (!token) {
    const baseUrlArg = baseUrl === PROD_URL ? "" : `-e ATL_BASE_URL=${baseUrl} `;
    process.stderr.write(
      "ATL_TOKEN is not set.\n" +
        "Create a Personal Access Token in the ATimeLogger web app:\n" +
        "  Settings -> API Tokens -> Generate token  (the value is shown only once)\n" +
        "Then register the server with:\n" +
        "  claude mcp add atl " +
        baseUrlArg +
        "-e ATL_TOKEN=atl_pat_... -- node " +
        new URL("./index.js", import.meta.url).pathname +
        "\n" +
        "(or run `npm run setup` in atl-mcp/ to paste the token interactively)\n"
    );
    process.exit(1);
  }
  if (!token.startsWith(PAT_PREFIX)) {
    // Legacy 365-day JWTs still work server-side, but can't be revoked.
    process.stderr.write(
      "ATL_TOKEN does not look like a personal access token (atl_pat_...) — " +
        "consider generating one in the web app under Settings -> API Tokens.\n"
    );
  }
  return { baseUrl, token };
}
