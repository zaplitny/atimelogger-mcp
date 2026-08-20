import { loadConfig, setupInstructions, normalizeBaseUrl } from "./config.js";
import { NetworkError, UsageError } from "./errors.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  /** Personal Access Token (atl_pat_...). */
  token: string;
  /** Backend base URL; defaults to production. */
  baseUrl?: string;
  /** Override the HTTP layer — tests, proxies, instrumentation. */
  fetch?: FetchLike;
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

/** Build an API client from an explicit token/base URL — never touches the environment. */
export function createApi(options: ApiOptions): Api {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${baseUrl}${path}`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${options.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new NetworkError(
        `Cannot reach ATimeLogger at ${baseUrl} — is the server running? (${(e as Error).message})`,
        { cause: e }
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(
        res.status,
        "",
        "Authentication failed: the token is invalid, expired, or revoked. Generate a new Personal Access Token in the ATimeLogger web app (Settings -> API Tokens) and update ATL_TOKEN (or run `npm run setup` in atimelogger-mcp/)."
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(res.status, text, `API error ${res.status} on ${method} ${path}: ${text || res.statusText}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}

// Environment-driven default, shared by the MCP server and the CLI. Built lazily
// so that importing this package as a library never reads env or exits the process.
let envApi: Api | undefined;
function defaultApi(): Api {
  if (!envApi) {
    const config = loadConfig();
    if (config.token) {
      envApi = createApi({ token: config.token, baseUrl: config.baseUrl });
    } else {
      // Docs-only mode: app_help answers from the public help site, so the
      // server still starts. Everything API-backed explains what is missing
      // rather than sending a token-less request.
      const refuse = async (): Promise<never> => {
        throw new UsageError(
          "ATL_TOKEN is not set — the server is in docs-only mode, only app_help (app documentation) works. " +
            "To use time tracking, the user needs API access (part of the Premium Sync plan).\n" +
            setupInstructions(config.baseUrl)
        );
      };
      envApi = { get: refuse, post: refuse, put: refuse, delete: refuse };
    }
  }
  return envApi;
}

export const api: Api = {
  get: (path) => defaultApi().get(path),
  post: (path, body) => defaultApi().post(path, body),
  put: (path, body) => defaultApi().put(path, body),
  delete: (path) => defaultApi().delete(path),
};
