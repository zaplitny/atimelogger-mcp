import test from "node:test";
import assert from "node:assert/strict";
import { createApi, ApiError } from "../dist/client.js";
import { NetworkError } from "../dist/errors.js";
import { mockFetch } from "./helpers.mjs";

const api = (routes, opts = {}) => {
  const fetchImpl = mockFetch(routes);
  return { api: createApi({ token: "atl_pat_x", baseUrl: "https://mock.test", fetch: fetchImpl, ...opts }), calls: fetchImpl.calls };
};

test("sends the bearer token and only sets a content type when there is a body", async () => {
  const { api: a, calls } = api({ "/api/thing": { ok: true } });
  await a.get("/api/thing");
  await a.post("/api/thing", { x: 1 });
  assert.equal(calls[0].headers.Authorization, "Bearer atl_pat_x");
  assert.equal(calls[0].headers["Content-Type"], undefined, "GET carries no content type");
  assert.equal(calls[1].headers["Content-Type"], "application/json");
  assert.deepEqual(calls[1].body, { x: 1 });
});

test("all four verbs reach the right method and path", async () => {
  const { api: a, calls } = api({});
  await Promise.all([a.get("/api/a"), a.post("/api/b"), a.put("/api/c", {}), a.delete("/api/d")]);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`).sort(),
    ["DELETE /api/d", "GET /api/a", "POST /api/b", "PUT /api/c"]
  );
});

test("trailing slashes on the base URL do not double up", async () => {
  const fetchImpl = mockFetch({});
  const a = createApi({ token: "t", baseUrl: "https://mock.test///", fetch: fetchImpl });
  await a.get("/api/thing");
  assert.equal(fetchImpl.calls[0].path, "/api/thing");
});

test("defaults to production when no base URL is given", async () => {
  const fetchImpl = mockFetch({});
  const seen = [];
  await createApi({ token: "t", fetch: async (url) => { seen.push(url); return new Response("{}", { status: 200 }); } }).get("/api/x");
  assert.ok(seen[0].startsWith("https://app.atimelogger.pro/"), seen[0]);
  assert.equal(fetchImpl.calls.length, 0);
});

test("an empty response body resolves to undefined rather than throwing", async () => {
  const { api: a } = api({ "PUT /api/activities/a1": new Response("", { status: 200 }) });
  assert.equal(await a.put("/api/activities/a1", {}), undefined);
});

test("401 and 403 become an ApiError pointing at token regeneration", async () => {
  for (const status of [401, 403]) {
    const { api: a } = api({ "/api/x": status });
    await assert.rejects(a.get("/api/x"), (e) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, status);
      assert.match(e.message, /Personal Access Token/);
      return true;
    });
  }
});

test("other failures become an ApiError carrying status and body", async () => {
  const { api: a } = api({ "/api/x": 500 });
  await assert.rejects(a.get("/api/x"), (e) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 500);
    assert.match(e.message, /upstream said no/);
    return true;
  });
});

test("a transport failure becomes a NetworkError that keeps the cause", async () => {
  const boom = new TypeError("fetch failed");
  const a = createApi({ token: "t", baseUrl: "https://mock.test", fetch: async () => { throw boom; } });
  await assert.rejects(a.get("/api/x"), (e) => {
    assert.ok(e instanceof NetworkError, `expected NetworkError, got ${e.constructor.name}`);
    assert.ok(!(e instanceof ApiError), "a dead network is not a server answer");
    assert.equal(e.cause, boom);
    assert.match(e.message, /Cannot reach ATimeLogger at https:\/\/mock.test/);
    return true;
  });
});

test("two clients never share credentials", async () => {
  const seen = [];
  const spy = async (url, init) => { seen.push(init.headers.Authorization); return new Response("{}", { status: 200 }); };
  await createApi({ token: "aaa", baseUrl: "https://mock.test", fetch: spy }).get("/api/x");
  await createApi({ token: "bbb", baseUrl: "https://mock.test", fetch: spy }).get("/api/x");
  assert.deepEqual(seen, ["Bearer aaa", "Bearer bbb"]);
});
