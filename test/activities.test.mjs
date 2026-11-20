import test from "node:test";
import assert from "node:assert/strict";
import {
  currentStatus, startActivity, stopActivity, pauseResumeActivity, logInterval, updateActivity, updateIntervalTime,
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
  assert.equal(s.active[1].started, undefined, "a paused timer has no start");
  assert.equal(s.active[1].seconds, 1800);
  assert.equal(s.active[1].elapsed, "30m");
});

test("a running timer's elapsed time includes the segment still running", async () => {
  // `duration` holds the finished segments (10 min); the current one started 5 min ago
  const start = new Date(Date.now() - 5 * 60_000).toISOString();
  const { ctx } = mockCtx({ "/api/activities": { activities: [{ id: "a1", typeId: "t1", status: "RUNNING", start, duration: 600 }] } });
  const s = await currentStatus("UTC", ctx);
  assert.ok(Math.abs(s.active[0].seconds - 900) <= 2, `expected about 900s, got ${s.active[0].seconds}`);
  assert.equal(s.active[0].elapsed, "15m");
});

test("updateActivity's tracked time counts a running timer's current segment too", async () => {
  const start = new Date(Date.now() - 20 * 60_000).toISOString();
  const { ctx } = mockCtx({
    "PATCH /api/activities/a1/comment": new Response(null, { status: 204 }),
    "GET /api/activities/a1": { id: "a1", typeId: "t1", status: "RUNNING", start, duration: 600 },
  });
  const r = await updateActivity({ activity_id: "a1", comment: "x" }, ctx);
  assert.equal(r.tracked, "30m");
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

test("stopActivity reports the server's post-stop duration, not the pre-stop snapshot", async () => {
  // Backdated stop: the running snapshot shows 2h elapsed, but the finalized
  // activity the stop endpoint returns records only 1h. The overstated snapshot
  // must not leak into `tracked`/`seconds`.
  const { ctx, calls } = mockCtx({
    "/api/activities": { activities: [{ ...RUNNING, duration: 7200 }] },
    "POST /api/activities/stop/a1": { id: "a1", typeId: "t1", status: "STOPPED", duration: 3600 },
  });
  const r = await stopActivity({ stopped_minutes_ago: 60, timezone: "UTC" }, ctx);
  assert.equal(r.seconds, 3600, "uses the recomputed duration from the stop response");
  assert.equal(r.tracked, "1h");
  const stop = calls.find((c) => c.path === "/api/activities/stop/a1");
  assert.ok(stop.search.startsWith("?time="), "the backdated finish is sent to the server");
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

test("updateActivity patches only the comment and never PUTs the whole record", async () => {
  const { ctx, calls } = mockCtx({
    "PATCH /api/activities/a1/comment": new Response(null, { status: 204 }),
    "GET /api/activities/a1": () => ({ ...STORED(), comment: "edited" }),
  });

  const r = await updateActivity({ activity_id: "a1", comment: "edited" }, ctx);

  const writes = calls.filter((c) => c.method !== "GET");
  assert.deepEqual(writes.map((c) => `${c.method} ${c.path}`), ["PATCH /api/activities/a1/comment"],
    "a PUT would soft-delete every interval a phone added since the read");
  assert.deepEqual(writes[0].body, { comment: "edited" });
  assert.equal(r.activity, "Development");
  assert.equal(r.comment, "edited");
  assert.equal(r.tracked, "2h", "the result is re-read from the backend");
});

test("updateActivity sends the full tag list, and can clear both fields", async () => {
  const { ctx, calls } = mockCtx({
    "PATCH /api/activities/a1/comment": new Response(null, { status: 204 }),
    "PATCH /api/activities/a1/tags": new Response(null, { status: 204 }),
    "GET /api/activities/a1": STORED(),
  });
  await updateActivity({ activity_id: "a1", tags: ["one", "two"] }, ctx);
  await updateActivity({ activity_id: "a1", comment: "", tags: [] }, ctx);

  const writes = calls.filter((c) => c.method === "PATCH").map((c) => [c.path, c.body]);
  assert.deepEqual(writes, [
    ["/api/activities/a1/tags", { tags: ["one", "two"] }],
    ["/api/activities/a1/comment", { comment: "" }],
    ["/api/activities/a1/tags", { tags: [] }],
  ]);
});

test("updateActivity with nothing to change is a UsageError", async () => {
  const { ctx, calls } = mockCtx({ "GET /api/activities/a1": STORED() });
  await assert.rejects(updateActivity({ activity_id: "a1" }, ctx), UsageError);
  assert.equal(calls.length, 0, "and it fails before touching the network");
});

/** A stopped activity with one entry 2026-08-05 09:00–10:00 UTC, and a backend that records the PUT. */
function entryBackend() {
  const from = Date.parse("2026-08-05T09:00:00Z") / 1000;
  const activity = { id: "a1", typeId: "t1", status: "STOPPED", duration: 3600,
    intervals: [{ id: "i1", from, to: from + 3600, duration: 3600 }] };
  return mockCtx({
    "GET /api/activities/a1": activity,
    "PUT /api/activities/a1/intervals/i1": () => new Response(null, { status: 200 }),
  });
}

test("updateIntervalTime moves one end of an entry and keeps the other, its type and the rest", async () => {
  const { ctx, calls } = entryBackend();
  const moved = await updateIntervalTime({ activity_id: "a1", interval_id: "i1", from: "2026-08-05 08:30", timezone: "UTC" }, ctx);
  const writes = calls.filter((c) => c.method !== "GET");
  assert.deepEqual(writes.map((c) => `${c.method} ${c.path}`), ["PUT /api/activities/a1/intervals/i1"],
    "only the one interval is written, never the whole activity");
  assert.deepEqual(writes[0].body, { id: "i1", activityId: "a1", typeId: "t1",
    start: "2026-08-05T08:30:00.000Z", finish: "2026-08-05T10:00:00.000Z" });
  assert.deepEqual(
    { from: moved.from, to: moved.to, was_from: moved.was_from, was_to: moved.was_to, duration: moved.duration },
    { from: "2026-08-05 08:30", to: "2026-08-05 10:00", was_from: "2026-08-05 09:00", was_to: "2026-08-05 10:00", duration: "1h 30m" }
  );
  assert.equal(moved.activity, "Development");
});

test("updateIntervalTime reads a bare HH:mm on the entry's own day, in the user's timezone", async () => {
  const { ctx, calls } = entryBackend();
  // 09:00–10:00 UTC is 12:00–13:00 in Moscow
  await updateIntervalTime({ activity_id: "a1", interval_id: "i1", to: "12:45", timezone: "Europe/Moscow" }, ctx);
  assert.equal(calls.find((c) => c.method === "PUT").body.finish, "2026-08-05T09:45:00.000Z");
});

test("updateIntervalTime refuses what the entry cannot be, without sending anything", async () => {
  const { ctx, calls } = entryBackend();
  await assert.rejects(updateIntervalTime({ activity_id: "a1", interval_id: "i1", timezone: "UTC" }, ctx), /Nothing to change/);
  await assert.rejects(updateIntervalTime({ activity_id: "a1", interval_id: "i1", to: "08:00", timezone: "UTC" }, ctx), /end before it starts/);
  await assert.rejects(updateIntervalTime({ activity_id: "a1", interval_id: "i1", to: "2099-01-01 10:00", timezone: "UTC" }, ctx), /future/);
  await assert.rejects(updateIntervalTime({ activity_id: "a1", interval_id: "nope", from: "08:00", timezone: "UTC" }, ctx), /list_intervals/);
  assert.ok(!calls.some((c) => c.method === "PUT"));
});
