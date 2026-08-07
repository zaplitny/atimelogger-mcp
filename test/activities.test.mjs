import test from "node:test";
import assert from "node:assert/strict";
import {
  currentStatus, startActivity, stopActivity, pauseResumeActivity, logInterval, updateActivity,
} from "../dist/tools/activities.js";
import { UsageError } from "../dist/errors.js";
import { mockCtx } from "./helpers.mjs";

const RUNNING = { id: "a1", typeId: "t1", status: "RUNNING", start: "2026-08-06T07:00:00.000Z", duration: 3600, tags: ["x"] };
const PAUSED = { id: "a2", typeId: "t3", status: "PAUSED", duration: 1800 };
const STORED = () => ({
  id: "a1", typeId: "t1", status: "STOPPED", comment: "original", tags: ["keep"], duration: 7200,
  intervals: [
    { id: "i1", start: "2026-08-05T09:00:00.000Z", finish: "2026-08-05T10:00:00.000Z", from: 1, to: 2, duration: 3600 },
    { id: "i2", start: "2026-08-05T11:00:00.000Z", finish: "2026-08-05T12:00:00.000Z", from: 3, to: 4, duration: 3600 },
  ],
});

test("currentStatus reports idle with an empty active list", async () => {
  const { ctx } = mockCtx({ "/api/activities": { activities: [{ id: "a3", typeId: "t1", status: "STOPPED", duration: 5 }] } });
  const s = await currentStatus("UTC", ctx);
  assert.equal(s.status, "idle");
  assert.deepEqual(s.active, [], "always an array, never a missing key");
  assert.match(s.now, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("currentStatus resolves type names and keeps running plus paused", async () => {
  const { ctx } = mockCtx({ "/api/activities": { activities: [RUNNING, PAUSED, { id: "z", typeId: "t1", status: "STOPPED", duration: 1 }] } });
  const s = await currentStatus("UTC", ctx);
  assert.equal(s.status, "active");
  assert.deepEqual(s.active.map((a) => `${a.activity}/${a.status}`), ["Development/RUNNING", "Sleep/PAUSED"]);
  assert.equal(s.active[0].started, "2026-08-06 07:00");
  assert.equal(s.active[0].seconds, 3600);
  assert.equal(s.active[0].elapsed, "1h");
  assert.equal(s.active[1].started, undefined, "a paused timer has no start");
});

test("startActivity resolves a fuzzy name and posts time=0 for now", async () => {
  const { ctx, calls } = mockCtx({ "POST /api/activities/start/t1": {} });
  const r = await startActivity({ type_name: "develop" }, ctx);
  assert.equal(r.activity, "Development");
  assert.equal(r.type_id, "t1");
  assert.equal(calls.at(-1).search, "?time=0", "0 means server-side now");
});

test("startActivity backdates by minutes and by wall clock", async () => {
  const { ctx, calls } = mockCtx({ "POST /api/activities/start/t1": {} });
  await startActivity({ type_id: "t1", started_minutes_ago: 30 }, ctx);
  const byMinutes = Number(calls.at(-1).search.replace("?time=", ""));
  assert.ok(Math.abs(Date.now() / 1000 - 30 * 60 - byMinutes) < 5, "roughly 30 minutes ago");

  await startActivity({ type_id: "t1", at: "2026-08-05 09:00", timezone: "UTC" }, ctx);
  assert.equal(calls.at(-1).search, `?time=${Date.parse("2026-08-05T09:00:00Z") / 1000}`);
});

test("startActivity rejects misuse with UsageError", async () => {
  const { ctx } = mockCtx({ "POST /api/activities/start/t1": {} });
  await assert.rejects(startActivity({}, ctx), UsageError, "no type given");
  await assert.rejects(startActivity({ type_name: "Work" }, ctx), UsageError, "a group cannot be started");
  await assert.rejects(startActivity({ type_id: "t1", at: "09:00", started_minutes_ago: 5 }, ctx), UsageError, "two backdating forms");
  await assert.rejects(startActivity({ type_id: "t1", at: "2099-01-01 09:00" }, ctx), UsageError, "the future");
});

test("stopActivity needs no name when exactly one activity is active", async () => {
  const { ctx, calls } = mockCtx({ "/api/activities": { activities: [RUNNING] }, "POST /api/activities/stop/a1": {} });
  const r = await stopActivity({}, ctx);
  assert.equal(r.activity, "Development");
  assert.equal(r.activity_id, "a1");
  assert.equal(r.tracked, "1h");
  assert.equal(r.seconds, 3600);
  assert.ok(calls.some((c) => c.path === "/api/activities/stop/a1"));
});

test("stopActivity demands a name when several are active, and names them", async () => {
  const { ctx } = mockCtx({ "/api/activities": { activities: [RUNNING, PAUSED] } });
  await assert.rejects(stopActivity({}, ctx), (e) => {
    assert.ok(e instanceof UsageError);
    assert.match(e.message, /Multiple activities are active/);
    assert.match(e.message, /Development/);
    assert.match(e.message, /Sleep/);
    return true;
  });
  const picked = await stopActivity({ type_name: "sleep" }, mockCtx({
    "/api/activities": { activities: [RUNNING, PAUSED] }, "POST /api/activities/stop/a2": {},
  }).ctx);
  assert.equal(picked.activity, "Sleep");
});

test("stopActivity reports when nothing is running and when an id is unknown", async () => {
  await assert.rejects(stopActivity({}, mockCtx({ "/api/activities": { activities: [] } }).ctx), (e) => {
    assert.ok(e instanceof UsageError);
    assert.match(e.message, /No running\/paused activity found/);
    return true;
  });
  await assert.rejects(
    stopActivity({ activity_id: "ghost" }, mockCtx({ "/api/activities": { activities: [RUNNING] } }).ctx),
    (e) => e instanceof UsageError && /with that id/.test(e.message)
  );
});

test("pauseResumeActivity targets the right status and reports the new one", async () => {
  const paused = await pauseResumeActivity({ action: "pause" }, mockCtx({
    "/api/activities": { activities: [RUNNING] }, "POST /api/activities/pause/a1": {},
  }).ctx);
  assert.deepEqual({ a: paused.activity, s: paused.status }, { a: "Development", s: "PAUSED" });

  const resumed = await pauseResumeActivity({ action: "resume" }, mockCtx({
    "/api/activities": { activities: [PAUSED] }, "POST /api/activities/resume/a2": {},
  }).ctx);
  assert.deepEqual({ a: resumed.activity, s: resumed.status }, { a: "Sleep", s: "RUNNING" });

  await assert.rejects(
    pauseResumeActivity({ action: "resume" }, mockCtx({ "/api/activities": { activities: [RUNNING] } }).ctx),
    UsageError,
    "cannot resume something that is running"
  );
});

test("logInterval sends the payload shape the backend validates", async () => {
  const { ctx, calls } = mockCtx({ "POST /api/activities": {} });
  const r = await logInterval(
    { type_name: "development", from: "2026-08-05 09:00", to: "2026-08-05 11:30", comment: "c", tags: ["a"], timezone: "UTC" },
    ctx
  );
  const body = calls.at(-1).body;
  assert.equal(body.typeId, "t1");
  assert.equal(body.status, "STOPPED");
  assert.equal(body.start, undefined, "a stopped activity must not carry a top-level start");
  assert.equal(body.intervals.length, 1);
  assert.equal(body.intervals[0].start, "2026-08-05T09:00:00.000Z", "the exact format the server's Jackson config requires");
  assert.equal(body.intervals[0].finish, "2026-08-05T11:30:00.000Z");
  assert.deepEqual({ d: r.duration, s: r.seconds, c: r.comment, t: r.tags }, { d: "2h 30m", s: 9000, c: "c", t: ["a"] });
});

test("logInterval defaults comment and tags rather than omitting them", async () => {
  const { ctx, calls } = mockCtx({ "POST /api/activities": {} });
  await logInterval({ type_id: "t1", from: "2026-08-05 09:00", to: "2026-08-05 10:00", timezone: "UTC" }, ctx);
  assert.deepEqual({ comment: calls.at(-1).body.comment, tags: calls.at(-1).body.tags }, { comment: "", tags: [] });
});

test("logInterval rejects a backwards or empty range", async () => {
  const { ctx } = mockCtx({ "POST /api/activities": {} });
  const bad = { type_id: "t1", from: "2026-08-05 11:00", to: "2026-08-05 09:00", timezone: "UTC" };
  await assert.rejects(logInterval(bad, ctx), UsageError);
  await assert.rejects(logInterval({ ...bad, to: "2026-08-05 11:00" }, ctx), UsageError, "zero length");
});

test("updateActivity round-trips the record so intervals survive", async () => {
  let stored = STORED();
  const before = STORED();
  const { ctx, calls } = mockCtx({
    "GET /api/activities/a1": () => stored,
    "PUT /api/activities/a1": ({ body }) => { stored = body; return new Response("", { status: 200 }); },
  });

  const r = await updateActivity({ activity_id: "a1", comment: "edited" }, ctx);

  assert.deepEqual(stored.intervals, before.intervals, "a naive PUT would soft-delete every interval");
  assert.equal(stored.comment, "edited");
  assert.deepEqual(stored.tags, before.tags, "tags untouched when not supplied");
  assert.deepEqual(
    calls.filter((c) => c.path === "/api/activities/a1").map((c) => c.method),
    ["GET", "PUT", "GET"],
    "read, modify, write, then re-read to report the stored state"
  );
  assert.equal(r.activity, "Development");
  assert.equal(r.tracked, "2h");
});

test("updateActivity replaces tags wholesale and can clear fields", async () => {
  let stored = STORED();
  const { ctx } = mockCtx({
    "GET /api/activities/a1": () => stored,
    "PUT /api/activities/a1": ({ body }) => { stored = body; return new Response("", { status: 200 }); },
  });
  await updateActivity({ activity_id: "a1", tags: ["one", "two"] }, ctx);
  assert.deepEqual(stored.tags, ["one", "two"]);
  assert.equal(stored.comment, "original", "comment survives a tags-only update");

  await updateActivity({ activity_id: "a1", comment: "", tags: [] }, ctx);
  assert.equal(stored.comment, "");
  assert.deepEqual(stored.tags, []);
  assert.deepEqual(stored.intervals.length, 2, "clearing fields still preserves tracked time");
});

test("updateActivity with nothing to change is a UsageError", async () => {
  const { ctx, calls } = mockCtx({ "GET /api/activities/a1": STORED() });
  await assert.rejects(updateActivity({ activity_id: "a1" }, ctx), UsageError);
  assert.equal(calls.length, 0, "and it fails before touching the network");
});
