import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { TYPES } from "./helpers.mjs";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const ROUTES = (path, body) => {
  if (path === "/api/users/me") return { timeZone: "UTC" };
  if (path === "/api/types") return TYPES;
  if (path === "/api/activities") return { activities: [{ id: "a1", typeId: "t1", status: "RUNNING", start: "2026-08-06T07:00:00.000Z", duration: 3600 }] };
  if (path === "/api/statistics") return { total: { info: { total: 3600 }, groupedStatistics: [{ types: ["t1"], duration: 3600 }] }, periods: [] };
  if (path.startsWith("/api/intervals")) {
    return body?.tags?.includes("none")
      ? { content: [], number: 0, totalElements: 0, totalPages: 0, last: true }
      : { content: [{ title: "Today", intervals: [{ id: "i1", activityId: "a1", typeId: "t1", from: 1754470800, to: 1754474400, duration: 3600 }] }],
          number: 0, totalElements: 1, totalPages: 1, last: true };
  }
  return {};
};

let server, baseUrl;
test.before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(ROUTES(req.url, raw ? JSON.parse(raw) : undefined)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

/** Run the CLI; never rejects, so exit codes can be asserted. */
function run(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { PATH: process.env.PATH, TZ: "UTC", ATL_TOKEN: "atl_pat_test", ATL_BASE_URL: baseUrl, ...env } },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr })
    );
  });
}
const json = (s) => JSON.parse(s);

test("status prints JSON and exits 0", async () => {
  const r = await run(["status", "--compact"]);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
  const out = json(r.stdout);
  assert.equal(out.status, "active");
  assert.equal(out.active[0].activity, "Development");
  assert.equal(r.stdout.trimEnd().split("\n").length, 1, "--compact is a single line");
});

test("output is pretty-printed by default and parses either way", async () => {
  const r = await run(["types"]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes("\n  "), "indented");
  assert.deepEqual(json(r.stdout).types.map((t) => t.name), ["Work", "Sleep"]);
});

test("report and intervals expose machine-readable fields", async () => {
  const rep = json((await run(["report", "--period", "today", "--compact"])).stdout);
  assert.equal(rep.seconds, 3600);
  assert.equal(rep.duration, "1h");

  const iv = json((await run(["intervals", "--period", "today", "--compact"])).stdout);
  assert.equal(iv.has_more, false);
  assert.equal(iv.days[0].intervals[0].seconds, 3600);
  assert.equal(iv.days[0].intervals[0].activity_id, "a1");
});

test("an empty range still yields a days array, so jq pipelines hold", async () => {
  const iv = json((await run(["intervals", "--period", "today", "--tag", "none", "--compact"])).stdout);
  assert.deepEqual(iv.days, []);
});

test("--help and --version exit 0 without touching the network", async () => {
  const help = await run(["--help"], { ATL_TOKEN: "", ATL_BASE_URL: "" });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /read-only JSON access/);

  const version = await run(["--version"], { ATL_TOKEN: "", ATL_BASE_URL: "" });
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("usage mistakes exit 2 with a JSON error on stderr and nothing on stdout", async () => {
  const cases = [
    [[], /No command given/],
    [["frobnicate"], /Unknown command/],
    [["report", "--period", "last_year"], /Unknown period/],
    [["report"], /Provide `period`/],
    [["report", "--period", "today", "--from", "2026-01-01"], /not both/],
    [["intervals", "--period", "today", "--size", "0"], /--size must be an integer/],
    [["intervals", "--period", "today", "--size="], /--size must be an integer/],
    [["intervals", "--period", "today", "--page", "0x10"], /--page must be an integer/],
    [["report", "--period", "today", "--group-by", "hourly"], /--group-by must be/],
    [["intervals", "--from", "2026-01-01", "--to", "2026-08-01"], /at most 100 days/],
    [["report", "--period", "today", "--type", "kayaking"], /No activity type matches/],
    [["--nonsense"], /Unknown option/],
  ];
  for (const [args, pattern] of cases) {
    const r = await run(args);
    assert.equal(r.code, 2, `exit code for ${JSON.stringify(args)} (stderr: ${r.stderr})`);
    assert.equal(r.stdout, "", `stdout must stay clean for ${JSON.stringify(args)}`);
    assert.match(json(r.stderr).error, pattern);
  }
});

test("a missing token is a usage error naming the variable, not MCP setup prose", async () => {
  const r = await run(["status"], { ATL_TOKEN: "" });
  assert.equal(r.code, 2);
  assert.match(json(r.stderr).error, /ATL_TOKEN is not set/);
  assert.doesNotMatch(r.stderr, /claude mcp add/, "the CLI must not tell a script author to register an MCP server");
});

test("an unreachable backend is a runtime failure: exit 1", async () => {
  const r = await run(["status"], { ATL_BASE_URL: "http://127.0.0.1:1" });
  assert.equal(r.code, 1);
  assert.match(json(r.stderr).error, /Cannot reach ATimeLogger/);
});

test("doctor reports a healthy setup and exits 0", async () => {
  const r = await run(["doctor", "--compact"]);
  assert.equal(r.code, 0);
  const out = json(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.base_url, baseUrl);
  assert.deepEqual(out.checks.map((c) => c.name), ["token", "connection", "auth", "types"]);
  assert.ok(out.checks.every((c) => c.ok));
  assert.match(out.checks.find((c) => c.name === "types").detail, /3 activity type\(s\)/);
});

test("doctor diagnoses a missing token without demanding one first", async () => {
  const r = await run(["doctor", "--compact"], { ATL_TOKEN: "" });
  assert.equal(r.code, 1, "unhealthy is exit 1, not the usage-error 2");
  const out = json(r.stdout);
  assert.equal(out.ok, false);
  assert.deepEqual(out.checks.map((c) => c.name), ["token"]);
  assert.match(out.checks[0].detail, /ATL_TOKEN is not set/);
});

test("doctor separates an unreachable host from a rejected token", async () => {
  const down = json((await run(["doctor", "--compact"], { ATL_BASE_URL: "http://127.0.0.1:1" })).stdout);
  assert.equal(down.ok, false);
  const conn = down.checks.find((c) => c.name === "connection");
  assert.equal(conn.ok, false);
  assert.match(conn.detail, /cannot reach/);
  assert.equal(down.checks.find((c) => c.name === "auth"), undefined, "no auth verdict when we never connected");
});

test("doctor never echoes the token", async () => {
  const secret = "atl_pat_SUPERSECRETVALUE";
  const r = await run(["doctor", "--compact"], { ATL_TOKEN: secret });
  assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret));
  assert.match(json(r.stdout).checks[0].detail, /24 chars/, "length only");
});

test("the CLI exposes no write commands", async () => {
  for (const cmd of ["start", "stop", "log", "update", "pause"]) {
    const r = await run([cmd]);
    assert.equal(r.code, 2, cmd);
    assert.match(json(r.stderr).error, /Unknown command/, cmd);
  }
});
