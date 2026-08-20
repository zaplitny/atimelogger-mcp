import { createContext } from "../dist/context.js";

export const TYPES = [
  { id: "g1", name: "Work", group: true, parentId: null, deleted: false, archived: false },
  { id: "t1", name: "Development", group: false, parentId: "g1", deleted: false, archived: false },
  { id: "t2", name: "Design", group: false, parentId: "g1", deleted: false, archived: false },
  { id: "t3", name: "Sleep", group: false, parentId: null, deleted: false, archived: false },
  { id: "t4", name: "Retired", group: false, parentId: null, deleted: false, archived: true },
  { id: "t5", name: "Gone", group: false, parentId: null, deleted: true, archived: false },
];

/**
 * Fake fetch over a `{"METHOD /path": handler}` map. A handler may be a value
 * (sent as JSON 200), a number (HTTP status), a Response, or a function of
 * {body, url}. Every call is recorded on `.calls`.
 */
export function mockFetch(routes = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, search: u.search, body, headers: init.headers ?? {} });
    const handler = routes[`${method} ${u.pathname}`] ?? routes[u.pathname];
    const out = typeof handler === "function" ? await handler({ body, url: u }) : handler;
    if (out instanceof Response) return out;
    if (out === undefined) return new Response(JSON.stringify({}), { status: 200 });
    if (typeof out === "number") return new Response("upstream said no", { status: out });
    return new Response(JSON.stringify(out), { status: 200 });
  };
  impl.calls = calls;
  return impl;
}

/** A Ctx wired to a mock backend, plus the recorded calls. */
export function mockCtx(routes = {}) {
  const fetchImpl = mockFetch({ "/api/types": TYPES, "/api/users/me": { timeZone: "UTC" }, ...routes });
  return {
    ctx: createContext({ token: "test-token", baseUrl: "https://mock.test", fetch: fetchImpl }),
    calls: fetchImpl.calls,
    fetchImpl,
  };
}

export const pathsHit = (calls, path) => calls.filter((c) => c.path === path).length;
