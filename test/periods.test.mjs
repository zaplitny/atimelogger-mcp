import test from "node:test";
import assert from "node:assert/strict";
import { resolveRange, rangeDays, wallTimeToUtc, unixToLocal, PERIOD_WORDS } from "../dist/periods.js";
import { UsageError } from "../dist/errors.js";

const TZ = "Europe/Warsaw";

test("every period word resolves to a sane range", () => {
  for (const period of PERIOD_WORDS) {
    const r = resolveRange({ period }, TZ);
    assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/, `${period} from`);
    assert.match(r.to, /^\d{4}-\d{2}-\d{2}$/, `${period} to`);
    assert.ok(r.from <= r.to, `${period}: from must not be after to`);
  }
});

test("weeks start on Monday and last_week is a full seven days", () => {
  const lastWeek = resolveRange({ period: "last_week" }, TZ);
  assert.equal(rangeDays(lastWeek), 7);
  const monday = new Date(`${lastWeek.from}T12:00:00Z`).getUTCDay();
  assert.equal(monday, 1, "last_week starts on a Monday");
});

test("fixed-length periods have the length their name promises", () => {
  assert.equal(rangeDays(resolveRange({ period: "today" }, TZ)), 1);
  assert.equal(rangeDays(resolveRange({ period: "yesterday" }, TZ)), 1);
  assert.equal(rangeDays(resolveRange({ period: "last_7_days" }, TZ)), 7);
  assert.equal(rangeDays(resolveRange({ period: "last_30_days" }, TZ)), 30);
});

test("explicit from/to passes through", () => {
  assert.deepEqual(resolveRange({ from: "2026-03-01", to: "2026-03-31" }, TZ), {
    from: "2026-03-01",
    to: "2026-03-31",
  });
  assert.equal(rangeDays({ from: "2026-03-01", to: "2026-03-31" }), 31);
});

test("range misuse raises UsageError, not a bare Error", () => {
  const cases = [
    [{}, "neither period nor dates"],
    [{ from: "2026-03-01" }, "from without to"],
    [{ period: "today", from: "2026-03-01" }, "period mixed with dates"],
    [{ from: "01/03/2026", to: "2026-03-31" }, "wrong date format"],
    [{ period: "last_year" }, "unknown period word"],
  ];
  for (const [args, label] of cases) {
    assert.throws(() => resolveRange(args, TZ), UsageError, label);
  }
});

test("the unknown-period message lists the valid words", () => {
  assert.throws(
    () => resolveRange({ period: "this_wek" }, TZ),
    (e) => e instanceof UsageError && e.message.includes("this_week") && e.message.includes("last_30_days")
  );
});

test("wallTimeToUtc is DST-correct across a spring-forward boundary", () => {
  // Warsaw goes CET(+1) -> CEST(+2) on 2026-03-29 at 02:00 local.
  assert.equal(wallTimeToUtc("2026-03-28 12:00", TZ).toISOString(), "2026-03-28T11:00:00.000Z");
  assert.equal(wallTimeToUtc("2026-03-30 12:00", TZ).toISOString(), "2026-03-30T10:00:00.000Z");
});

test("wallTimeToUtc is DST-correct across an autumn fall-back boundary", () => {
  // Warsaw goes CEST(+2) -> CET(+1) on 2026-10-25 at 03:00 local.
  assert.equal(wallTimeToUtc("2026-10-24 12:00", TZ).toISOString(), "2026-10-24T10:00:00.000Z");
  assert.equal(wallTimeToUtc("2026-10-26 12:00", TZ).toISOString(), "2026-10-26T11:00:00.000Z");
});

test("wallTimeToUtc accepts both separators and optional seconds", () => {
  const expected = "2026-06-01T10:00:00.000Z";
  assert.equal(wallTimeToUtc("2026-06-01 12:00", TZ).toISOString(), expected);
  assert.equal(wallTimeToUtc("2026-06-01T12:00", TZ).toISOString(), expected);
  assert.equal(wallTimeToUtc("2026-06-01 12:00:00", TZ).toISOString(), expected);
});

test("wallTimeToUtc rejects malformed input with a UsageError", () => {
  // A bad datetime is a caller mistake, not a runtime fault — embedders branch on this.
  assert.throws(() => wallTimeToUtc("June 1st", TZ), (e) => e instanceof UsageError && /Invalid datetime/.test(e.message));
  assert.throws(() => wallTimeToUtc("2026-06-01", TZ), UsageError);
});

test("unixToLocal round-trips wall time in the same zone", () => {
  const utc = wallTimeToUtc("2026-07-04 08:30", TZ);
  assert.equal(unixToLocal(utc.getTime() / 1000, TZ), "2026-07-04 08:30");
  assert.equal(unixToLocal(utc.getTime() / 1000, "UTC"), "2026-07-04 06:30");
});

test("unixToLocal renders midnight as 00:00, not 24:00", () => {
  const utc = wallTimeToUtc("2026-07-04 00:00", TZ);
  assert.equal(unixToLocal(utc.getTime() / 1000, TZ), "2026-07-04 00:00");
});
