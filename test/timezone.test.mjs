import test from "node:test";
import assert from "node:assert/strict";
import { createTimezone } from "../dist/timezone.js";
import { createApi } from "../dist/client.js";

const SYSTEM = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** A resolver whose /api/users/me response can be flipped mid-test. */
function resolver(initial = { timeZone: "Europe/Berlin" }) {
  const state = { reply: initial, calls: 0 };
  const api = createApi({
    token: "t", baseUrl: "https://mock.test",
    fetch: async () => {
      state.calls++;
      if (state.reply === "fail") return new Response("nope", { status: 502 });
      return new Response(JSON.stringify(state.reply), { status: 200 });
    },
  });
  return { tz: createTimezone(api), state };
}

const jump = (t, ms) => {
  const real = Date.now;
  t.after(() => { Date.now = real; });
  Date.now = () => real() + ms;
};

test("an explicit override short-circuits before any request", async () => {
  const { tz, state } = resolver();
  assert.equal(await tz.effectiveTimezone("Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(state.calls, 0);
});

test("the profile timezone is fetched once and reused within the hour", async () => {
  const { tz, state } = resolver();
  assert.equal(await tz.effectiveTimezone(), "Europe/Berlin");
  assert.equal(await tz.effectiveTimezone(), "Europe/Berlin");
  assert.equal(state.calls, 1);
});

test("an empty profile timezone falls back to this machine's", async () => {
  const { tz } = resolver({});
  assert.equal(await tz.effectiveTimezone(), SYSTEM);
});

test("the timezone refreshes after the TTL", async (t) => {
  const { tz, state } = resolver();
  await tz.effectiveTimezone();
  state.reply = { timeZone: "Asia/Tokyo" };
  jump(t, 2 * 60 * 60 * 1000);
  assert.equal(await tz.effectiveTimezone(), "Asia/Tokyo");
  assert.equal(state.calls, 2);
});

test("a failed refresh keeps the zone already resolved", async (t) => {
  const { tz, state } = resolver();
  assert.equal(await tz.effectiveTimezone(), "Europe/Berlin");
  state.reply = "fail";
  jump(t, 2 * 60 * 60 * 1000);
  assert.equal(
    await tz.effectiveTimezone(),
    "Europe/Berlin",
    "swapping in the machine zone here would silently shift day boundaries and written interval times"
  );
});

test("with nothing cached, a failure falls back and retries on the next call", async () => {
  const { tz, state } = resolver("fail");
  assert.equal(await tz.effectiveTimezone(), SYSTEM);
  state.reply = { timeZone: "Europe/Berlin" };
  assert.equal(await tz.effectiveTimezone(), "Europe/Berlin", "a startup blip must not pin the fallback");
});
