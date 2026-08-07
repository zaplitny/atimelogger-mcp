import test from "node:test";
import assert from "node:assert/strict";
import { timeReport, listIntervals } from "../dist/tools/reports.js";
import { listTypes } from "../dist/tools/types.js";
import { UsageError } from "../dist/errors.js";
import { mockCtx } from "./helpers.mjs";

const STATS = {
  total: {
    info: { total: 9000 },
    groupedStatistics: [
      { types: ["g1"], duration: 7200, children: [{ types: ["t1"], duration: 5400 }, { types: ["t2"], duration: 1800 }] },
      { types: ["t3"], duration: 1800 },
    ],
  },
  periods: [{ title: "Aug 5", info: { total: 9000 } }, { title: "Aug 6", info: { total: 0 } }],
};

const PAGE = {
  content: [{
    title: "Yesterday",
    intervals: [
      { id: "i1", activityId: "a1", typeId: "t1", from: 1754377200, to: 1754384400, duration: 7200, comment: "c", tags: ["x"] },
      { id: "i2", typeId: "t3", from: 1754388000, to: 1754389800, duration: 1800 },
    ],
  }],
  number: 0, totalElements: 3, totalPages: 2, last: false,
};

test("timeReport reports both humanized and raw totals, sorted by duration", async () => {
  const { ctx } = mockCtx({ "POST /api/statistics": STATS });
  const r = await timeReport({ period: "today", timezone: "UTC" }, ctx);
  assert.equal(r.duration, "2h 30m");
  assert.equal(r.seconds, 9000);
  assert.deepEqual(r.by_type.map((t) => t.type), ["Work", "Sleep"], "longest first");
  assert.deepEqual(r.by_type[0].children.map((c) => c.type), ["Development", "Design"]);
  assert.equal(r.by_type[0].children[0].seconds, 5400);
  assert.equal(r.by_type[1].children, undefined, "leaves carry no children key");
});

test("timeReport keeps empty buckets so a series has no holes", async () => {
  const { ctx } = mockCtx({ "POST /api/statistics": STATS });
  const r = await timeReport({ period: "today", timezone: "UTC" }, ctx);
  assert.deepEqual(r.periods, [
    { period: "Aug 5", duration: "2h 30m", seconds: 9000 },
    { period: "Aug 6", duration: "0s", seconds: 0 },
  ]);
});

test("timeReport survives an empty account without dropping keys", async () => {
  const { ctx } = mockCtx({ "POST /api/statistics": { total: { info: { total: 0 }, groupedStatistics: [] }, periods: [] } });
  const r = await timeReport({ period: "today", timezone: "UTC" }, ctx);
  assert.deepEqual(r.by_type, []);
  assert.deepEqual(r.periods, []);
  assert.equal(r.seconds, 0);
});

test("timeReport resolves name filters to ids, allows groups, and forwards the range", async () => {
  const { ctx, calls } = mockCtx({ "POST /api/statistics": STATS });
  await timeReport(
    { from: "2026-08-01", to: "2026-08-06", type_names: ["Work", "sleep"], type_ids: ["t2"], tags: ["x"], group_by: "WEEK", timezone: "UTC" },
    ctx
  );
  const body = calls.find((c) => c.path === "/api/statistics").body;
  assert.deepEqual(body.types, ["g1", "t3", "t2"], "resolved names then explicit ids");
  assert.deepEqual({ from: body.from, to: body.to, tz: body.timezone, g: body.groupBy }, {
    from: "2026-08-01", to: "2026-08-06", tz: "UTC", g: "WEEK",
  });
});

test("timeReport omits empty filters instead of sending empty arrays", async () => {
  const { ctx, calls } = mockCtx({ "POST /api/statistics": STATS });
  await timeReport({ period: "today", tags: [], type_names: [], timezone: "UTC" }, ctx);
  const body = calls.find((c) => c.path === "/api/statistics").body;
  assert.equal(body.types, undefined);
  assert.equal(body.tags, undefined);
  assert.equal(body.groupBy, "DAY", "defaults to daily buckets");
});

test("listIntervals returns typed entries with raw seconds and the owning activity", async () => {
  const { ctx } = mockCtx({ "POST /api/intervals": PAGE });
  const p = await listIntervals({ period: "yesterday", timezone: "UTC" }, ctx);
  const [first, second] = p.days[0].intervals;
  assert.equal(p.days[0].day, "Yesterday");
  assert.equal(first.type, "Development");
  assert.equal(first.activity_id, "a1");
  assert.equal(first.seconds, 7200);
  assert.equal(first.duration, "2h");
  assert.match(first.from, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.deepEqual({ c: first.comment, t: first.tags }, { c: "c", t: ["x"] });
  assert.equal(second.activity_id, undefined, "absent rather than null when the backend omits it");
  assert.equal(second.comment, undefined);
});

test("listIntervals exposes paging as data, not prose", async () => {
  const { ctx } = mockCtx({ "POST /api/intervals": PAGE });
  const p = await listIntervals({ period: "yesterday", timezone: "UTC" }, ctx);
  assert.equal(p.has_more, true);
  assert.equal(p.total_pages, 2);
  assert.equal(p.total_days, 3);
  assert.equal(p.page, 0);
});

test("listIntervals on an empty range still has a days array", async () => {
  const { ctx } = mockCtx({ "POST /api/intervals": { content: [], number: 0, totalElements: 0, totalPages: 0, last: true } });
  const p = await listIntervals({ period: "today", timezone: "UTC" }, ctx);
  assert.deepEqual(p.days, [], "the whole point: destructuring must not explode on a quiet day");
  assert.equal(p.has_more, false);
});

test("listIntervals forwards paging and refuses more than 100 days", async () => {
  const { ctx, calls } = mockCtx({ "POST /api/intervals": PAGE });
  await listIntervals({ period: "today", page: 2, size: 5, timezone: "UTC" }, ctx);
  assert.equal(calls.at(-1).search, "?page=2&size=5");

  await assert.rejects(listIntervals({ from: "2026-01-01", to: "2026-08-01", timezone: "UTC" }, ctx), (e) => {
    assert.ok(e instanceof UsageError);
    assert.match(e.message, /at most 100 days/);
    return true;
  });
  assert.equal(calls.filter((c) => c.path === "/api/intervals").length, 1, "rejected before the request");
});

test("listTypes builds a tree and hides archived types by default", async () => {
  const { ctx } = mockCtx();
  const visible = await listTypes(false, ctx);
  assert.deepEqual(visible.types.map((t) => t.name), ["Work", "Sleep"]);
  assert.deepEqual(visible.types[0].children.map((t) => t.name), ["Development", "Design"]);
  assert.equal(visible.types[1].children, undefined, "a leaf has no children key");

  const all = await listTypes(true, ctx);
  assert.ok(all.types.some((t) => t.name === "Retired" && t.archived === true));
  assert.ok(!all.types.some((t) => t.name === "Gone"), "deleted types stay hidden either way");
});
