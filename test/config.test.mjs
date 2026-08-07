import test from "node:test";
import assert from "node:assert/strict";
import { readEnvConfig, PROD_URL, DOCS_URL } from "../dist/config.js";
import { clientFromEnv } from "../dist/core.js";
import { UsageError } from "../dist/errors.js";

/** Run fn with exactly the given ATL_* environment, restoring afterwards. */
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith("ATL_")).map((k) => [k, process.env[k]]));
  for (const k of Object.keys(saved)) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); }
  finally {
    for (const k of Object.keys(process.env)) if (k.startsWith("ATL_")) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("readEnvConfig defaults the API and docs URLs", () => {
  withEnv({ ATL_TOKEN: "atl_pat_x" }, () => {
    const c = readEnvConfig();
    assert.equal(c.token, "atl_pat_x");
    assert.equal(c.baseUrl, PROD_URL);
    assert.equal(c.docsUrl, DOCS_URL, "docs live on their own host, always with a trailing slash");
  });
});

test("readEnvConfig normalises trailing slashes", () => {
  withEnv({ ATL_TOKEN: "t", ATL_BASE_URL: "https://staging.test///", ATL_DOCS_URL: "https://docs.test" }, () => {
    const c = readEnvConfig();
    assert.equal(c.baseUrl, "https://staging.test");
    assert.equal(c.docsUrl, "https://docs.test/");
  });
});

test("no token at all is docs-only mode, not an error", () => {
  withEnv({}, () => assert.equal(readEnvConfig().token, null));
});

test("a botched setup throws instead of silently running unauthenticated", () => {
  withEnv({ ATL_TOKEN: "" }, () => {
    assert.throws(() => readEnvConfig(), (e) => e instanceof UsageError && /set but empty/.test(e.message));
  });
  withEnv({ ATL_TOEKN: "atl_pat_typo" }, () => {
    assert.throws(() => readEnvConfig(), (e) => e instanceof UsageError && /ATL_TOEKN/.test(e.message));
  });
});

test("an unrecognized ATL_* var alongside a real token is not fatal", () => {
  withEnv({ ATL_TOKEN: "atl_pat_x", ATL_SOMETHING: "1" }, () => {
    assert.equal(readEnvConfig().token, "atl_pat_x");
  });
});

test("clientFromEnv throws rather than exiting the host process", () => {
  // Reaching the assertion at all proves no process.exit happened.
  withEnv({}, () => {
    assert.throws(() => clientFromEnv(), /ATL_TOKEN is not set/);
  });
  withEnv({ ATL_TOKEN: "" }, () => {
    assert.throws(() => clientFromEnv(), UsageError, "a botched config must not take the host down either");
  });
});

test("clientFromEnv stays silent — a library must not write to its host's stderr", () => {
  const written = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
  try {
    withEnv({ ATL_TOKEN: "legacy-jwt-not-a-pat", ATL_BASE_URL: "https://mock.test" }, () => clientFromEnv());
  } finally {
    process.stderr.write = real;
  }
  assert.deepEqual(written, [], `expected no stderr output, got: ${written.join("")}`);
});

test("clientFromEnv picks up ATL_BASE_URL, which a hand-rolled token read would miss", async () => {
  const seen = [];
  await withEnv({ ATL_TOKEN: "atl_pat_x", ATL_BASE_URL: "https://staging.test" }, () => {
    const c = clientFromEnv({ fetch: async (url) => { seen.push(url); return new Response("[]", { status: 200 }); } });
    return c.types();
  });
  assert.ok(seen[0].startsWith("https://staging.test/"), seen[0]);
});
