import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration, compact } from "../dist/format.js";

test("formatDuration: seconds below a minute", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(1), "1s");
  assert.equal(formatDuration(59), "59s");
  assert.equal(formatDuration(59.4), "59s", "rounds to the nearest second");
});

test("formatDuration: minutes and hours", () => {
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(90), "2m", "rounds to the nearest minute");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(8100), "2h 15m");
  assert.equal(formatDuration(86400), "24h", "no day unit — hours keep accumulating");
});

test("formatDuration: rounding never yields 60 minutes", () => {
  // 3591s is 59.85 minutes: rounding the minutes alone produced "60m".
  assert.equal(formatDuration(3591), "1h");
  // 190791s is 52h 59.85m: produced the nonsensical "52h 60m".
  assert.equal(formatDuration(190791), "53h");
  assert.equal(formatDuration(7199), "2h");
});

test("compact: strips null, undefined, empty string and empty array", () => {
  assert.deepEqual(
    compact({ a: 1, b: null, c: undefined, d: "", e: [], f: "x", g: [1], h: 0, i: false }),
    { a: 1, f: "x", g: [1], h: 0, i: false },
    "zero and false are values, not emptiness"
  );
});

test("compact: recurses into nested objects and arrays", () => {
  assert.deepEqual(compact({ outer: { keep: 1, drop: "" }, list: [{ keep: 2, drop: null }] }), {
    outer: { keep: 1 },
    list: [{ keep: 2 }],
  });
});

test("compact: leaves primitives alone", () => {
  assert.equal(compact("text"), "text");
  assert.equal(compact(5), 5);
  assert.equal(compact(null), null);
});
