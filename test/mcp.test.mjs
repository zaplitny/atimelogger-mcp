import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TYPES } from "./helpers.mjs";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const ACTIVITY = {
  id: "a1", typeId: "t1", status: "STOPPED", comment: "note", tags: ["keep"], duration: 7200,
  intervals: [{ id: "i1", start: "2026-08-05T09:00:00.000Z", finish: "2026-08-05T11:00:00.000Z", from: 1, to: 2, duration: 7200 }],
};

const routes = (path, method) => {
  if (path.startsWith("/api/activities/start/") || path.startsWith("/api/activities/stop/")) return { activities: [] };
  if (/^\/api\/activities\/[^/]+$/.test(path)) return ACTIVITY;
  if (path === "/api/activities" && method === "POST") return ACTIVITY;
  if (path === "/api/users/me") return { timeZone: "UTC" };
  if (path === "/api/types") return TYPES;
  if (path === "/api/activities") return { activities: [{ id: "a1", typeId: "t1", status: "RUNNING", start: "2026-08-06T07:00:00.000Z", duration: 3600 }] };
  if (path === "/api/statistics") return { total: { info: { total: 3600 }, groupedStatistics: [{ types: ["t1"], duration: 3600 }] }, periods: [{ title: "Aug 6", info: { total: 3600 } }] };
  if (path.startsWith("/api/intervals")) return {
    content: [{ title: "Today", intervals: [{ id: "i1", activityId: "a1", typeId: "t1", from: 1754470800, to: 1754474400, duration: 3600 }] }],
    number: 0, totalElements: 1, totalPages: 1, last: true,
  };
  return {};
};

let server, client;
test.before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(routes(req.url, req.method)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { PATH: process.env.PATH, TZ: "UTC", ATL_TOKEN: "atl_pat_test", ATL_BASE_URL: `http://127.0.0.1:${server.address().port}` },
  }));
});
test.after(async () => { await client?.close(); server?.close(); });

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: r.content?.[0]?.text ?? "" };
};
const callJson = async (name, args) => JSON.parse((await call(name, args)).text);

test("registers exactly the documented tool set", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "app_help", "get_current_status", "list_activity_types", "list_intervals", "log_interval",
    "pause_resume_activity", "start_activity", "stop_activity", "time_report", "update_activity",
  ]);
  for (const t of tools) {
    assert.ok(t.description?.length > 20, `${t.name} needs a description the model can act on`);
    assert.equal(t.inputSchema.type, "object", t.name);
  }
});

test("tool payloads stay compact and LLM-shaped, not the library shape", async () => {
  const status = await callJson("get_current_status");
  assert.equal(status.active[0].activity, "Development");
  assert.equal(status.active[0].seconds, undefined, "raw seconds are for programs, not the model");

  const report = await callJson("time_report", { period: "today" });
  assert.equal(report.total, "1h");
  assert.equal(report.seconds, undefined);
  assert.equal(report.periods[0].total, "1h");

  const intervals = await callJson("list_intervals", { period: "today" });
  assert.equal(intervals.days[0].intervals[0].activity_id, "a1", "ids flow between tools");
  assert.equal(intervals.days[0].intervals[0].seconds, undefined);
  assert.equal(intervals.has_more, undefined, "paging is prose for the model");
});

test("empty collections are dropped rather than sent as empty arrays", async () => {
  const types = await callJson("list_activity_types");
  assert.equal(types.types.find((t) => t.name === "Sleep").children, undefined);
});

test("writes report what happened", async () => {
  assert.equal((await callJson("start_activity", { type_name: "development" })).started, "Development");
  assert.equal((await callJson("stop_activity", {})).stopped, "Development");
  const logged = await callJson("log_interval", { type_name: "development", from: "2026-08-05 09:00", to: "2026-08-05 11:30" });
  assert.deepEqual({ l: logged.logged, d: logged.duration, f: logged.from }, { l: "Development", d: "2h 30m", f: "2026-08-05 09:00 (UTC)" });
  const updated = await callJson("update_activity", { activity_id: "a1", comment: "new" });
  assert.equal(updated.updated, "Development");
  assert.equal(updated.tracked, "2h");
});

test("failures come back as isError text, never as a thrown protocol error", async () => {
  for (const [name, args, pattern] of [
    ["time_report", { period: "today", from: "2026-01-01" }, /not both/],
    ["time_report", {}, /Provide `period`/],
    ["list_intervals", { from: "2026-01-01", to: "2026-08-01" }, /at most 100 days/],
    ["time_report", { period: "today", type_names: ["kayaking"] }, /No activity type matches/],
    ["start_activity", {}, /Provide type_name or type_id/],
    ["start_activity", { type_name: "Work" }, /groups excluded/],
    ["start_activity", { type_id: "g1" }, /is a group/],
    ["update_activity", { activity_id: "a1" }, /Nothing to update/],
  ]) {
    const r = await call(name, args);
    assert.ok(r.isError, `${name} ${JSON.stringify(args)} should be an error`);
    assert.match(r.text, pattern);
  }
});

test("docs-only mode: the server still starts and app_help answers, API tools explain what is missing", async () => {
  const docs = createServer((req, res) => {
    if (req.url.endsWith(".md")) { res.setHeader("content-type", "text/markdown"); res.end("# Goals\n\nSet a target."); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ note: "platforms differ", pages: [{ slug: "goals", title: "Goals", summary: "targets" }] }));
  });
  await new Promise((r) => docs.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${docs.address().port}`;
  const bare = new Client({ name: "docs-only", version: "0" });
  await bare.connect(new StdioClientTransport({
    command: process.execPath, args: [SERVER],
    env: { PATH: process.env.PATH, TZ: "UTC", ATL_DOCS_URL: url, ATL_BASE_URL: url }, // deliberately no ATL_TOKEN
  }));
  try {
    const toc = await bare.callTool({ name: "app_help", arguments: {} });
    assert.ok(!toc.isError, "app_help must work unauthenticated");
    assert.match(toc.content[0].text, /help_topics/);

    const page = await bare.callTool({ name: "app_help", arguments: { topics: ["goals"] } });
    assert.match(page.content[0].text, /Set a target/);

    for (const name of ["get_current_status", "time_report", "start_activity"]) {
      const r = await bare.callTool({ name, arguments: name === "time_report" ? { period: "today" } : { type_name: "x" } });
      assert.ok(r.isError, `${name} must fail without a token`);
      assert.match(r.content[0].text, /docs-only mode/, `${name} should explain the mode, not leak a raw 401`);
    }
  } finally {
    await bare.close();
    docs.close();
  }
});

test("the server advertises instructions that tell the model when to reach for it", async () => {
  const instructions = client.getInstructions();
  assert.ok(instructions.includes("update_activity"), "must steer annotation away from duplicate entries");
  assert.ok(/never show ids to the user/i.test(instructions));
});
