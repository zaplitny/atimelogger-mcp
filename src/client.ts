import { loadConfig } from "./config.js";

const config = loadConfig();

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `Cannot reach ATimeLogger at ${config.baseUrl} — is the server running? (${(e as Error).message})`
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(
      res.status,
      "",
      "Authentication failed: ATL_TOKEN is invalid, expired, or revoked. Generate a new Personal Access Token in the ATimeLogger web app (Settings -> API Tokens) and update ATL_TOKEN in the MCP config (or run `npm run setup` in atl-mcp/)."
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, text, `API error ${res.status} on ${method} ${path}: ${text || res.statusText}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
