import test from "node:test";
import assert from "node:assert/strict";
import { createTypesCache } from "../dist/types-cache.js";
import { createApi } from "../dist/client.js";
import { UsageError } from "../dist/errors.js";
import { mockFetch, TYPES } from "./helpers.mjs";

const cacheOver = (types = TYPES) => {
  const fetchImpl = mockFetch({ "/api/types": types });
  const api = createApi({ token: "t", baseUrl: "https://mock.test", fetch: fetchImpl });
  return { cache: createTypesCache(api), calls: fetchImpl.calls };
};

test("resolves an exact name, case-insensitively and ignoring surrounding space", async () => {
  const { cache } = cacheOver();
  for (const input of ["Development", "development", "  DEVELOPMENT  "]) {
    assert.equal((await cache.resolveTypeName(input)).id, "t1", input);
  }
});

test("falls back to a unique substring match", async () => {
  const { cache } = cacheOver();
  assert.equal((await cache.resolveTypeName("velop")).id, "t1");
});

test("an exact match wins over a substring match", async () => {
  const { cache } = cacheOver([
    { id: "x1", name: "Read", group: false, parentId: null, deleted: false, archived: false },
    { id: "x2", name: "Reading", group: false, parentId: null, deleted: false, archived: false },
  ]);
  assert.equal((await cache.resolveTypeName("Read")).id, "x1");
});

test("an ambiguous substring is a UsageError naming the candidates", async () => {
  const { cache } = cacheOver();
  // "de" is a substring of both Development and Design.
  await assert.rejects(cache.resolveTypeName("de"), (e) => {
    assert.ok(e instanceof UsageError);
    assert.match(e.message, /ambiguous/);
    assert.match(e.message, /Development/);
    assert.match(e.message, /Design/);
    return true;
  });
  assert.equal((await cache.resolveTypeName("des")).name, "Design", "a substring unique to one type still resolves");
});

test("no match is a UsageError listing what is available", async () => {
  const { cache } = cacheOver();
  await assert.rejects(cache.resolveTypeName("kayaking"), (e) => {
    assert.ok(e instanceof UsageError);
    assert.match(e.message, /No activity type matches "kayaking"/);
    assert.match(e.message, /Development/);
    return true;
  });
});

test("groups are excluded by default and included on request", async () => {
  const { cache } = cacheOver();
  await assert.rejects(cache.resolveTypeName("Work"), (e) => {
    assert.ok(e instanceof UsageError);
    assert.match(e.message, /groups excluded/);
    return true;
  });
  assert.equal((await cache.resolveTypeName("Work", { allowGroups: true })).id, "g1");
});

test("archived and deleted types are not resolvable by name", async () => {
  const { cache } = cacheOver();
  await assert.rejects(cache.resolveTypeName("Retired"), UsageError);
  await assert.rejects(cache.resolveTypeName("Gone"), UsageError);
});

test("resolveTypeById rejects unknown ids, deleted and archived types, and groups", async () => {
  const { cache } = cacheOver();
  assert.equal((await cache.resolveTypeById("t1")).name, "Development");
  await assert.rejects(cache.resolveTypeById("nope"), UsageError);
  await assert.rejects(cache.resolveTypeById("t5"), UsageError, "deleted");
  await assert.rejects(cache.resolveTypeById("g1"), UsageError, "group");
  assert.equal((await cache.resolveTypeById("g1", { allowGroups: true })).id, "g1");
  await assert.rejects(cache.resolveTypeById("t4"), UsageError, "archived: restore it first");
});

test("resolveTypeNames maps a list to ids and passes undefined through", async () => {
  const { cache } = cacheOver();
  assert.deepEqual(await cache.resolveTypeNames(["development", "sleep"]), ["t1", "t3"]);
  assert.equal(await cache.resolveTypeNames(undefined), undefined);
  assert.equal(await cache.resolveTypeNames([]), undefined, "an empty filter means no filter");
});

test("typeNameById covers every type, including archived and deleted", async () => {
  const { cache } = cacheOver();
  const names = await cache.typeNameById();
  assert.equal(names.get("t1"), "Development");
  assert.equal(names.get("t5"), "Gone", "history can still reference a deleted type");
});

test("the type list is fetched once and reused within the TTL", async () => {
  const { cache, calls } = cacheOver();
  await cache.getTypes();
  await cache.resolveTypeName("Sleep");
  await cache.typeNameById();
  assert.equal(calls.length, 1);
});

test("concurrent misses on a cold cache coalesce into one request", async () => {
  const { cache, calls } = cacheOver();
  // Fire the parallel access pattern of a real call (resolveTypeNames does
  // Promise.all over names, alongside typeNameById) before anything resolves.
  await Promise.all([cache.getTypes(), cache.resolveTypeName("Sleep"), cache.typeNameById()]);
  assert.equal(calls.length, 1, "one in-flight fetch is shared, not one per caller");
});

test("the snapshot is refetched once the TTL has passed", async (t) => {
  const { cache, calls } = cacheOver();
  await cache.getTypes();
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  Date.now = () => realNow() + 61_000;
  await cache.getTypes();
  assert.equal(calls.length, 2);
});

test("two caches over different backends stay isolated", async () => {
  const a = cacheOver();
  const b = cacheOver([{ id: "z9", name: "Elsewhere", group: false, parentId: null, deleted: false, archived: false }]);
  assert.equal((await a.cache.resolveTypeName("Development")).id, "t1");
  assert.equal((await b.cache.resolveTypeName("Elsewhere")).id, "z9");
  await assert.rejects(b.cache.resolveTypeName("Development"), UsageError);
});

test("invalidate drops the snapshot, and a load already under way cannot put the old list back", async () => {
  let version = 1;
  let release;
  const gate = new Promise((r) => (release = r));
  const fetchImpl = async () => {
    const seen = version;
    if (seen === 1) await gate; // the first load is still in flight when the cache is invalidated
    return new Response(JSON.stringify([{ ...TYPES[1], name: `v${seen}` }]), { status: 200 });
  };
  const cache = createTypesCache(createApi({ token: "t", baseUrl: "https://mock.test", fetch: fetchImpl }));
  const slow = cache.getTypes();
  version = 2;
  cache.invalidate();
  release();
  assert.equal((await slow)[0].name, "v1", "the caller that asked first still gets its answer");
  assert.equal((await cache.getTypes())[0].name, "v2", "but the cache holds the fresh list");
});

test("archived types stay out of starting and logging, by name or id, unless asked for", async () => {
  const { cache } = cacheOver();
  await assert.rejects(cache.resolveTypeName("Retired"), /No activity type matches "Retired"/);
  await assert.rejects(cache.resolveTypeById("t4"), /"Retired" is archived/);
  assert.equal((await cache.resolveTypeName("Retired", { includeArchived: true })).id, "t4");
  assert.equal((await cache.resolveTypeById("t4", { includeArchived: true })).id, "t4");
});

test("with archived types in play, the one active namesake wins", async () => {
  const { cache } = cacheOver([
    { id: "old", name: "Piano", group: false, parentId: null, deleted: false, archived: true },
    { id: "new", name: "Piano", group: false, parentId: null, deleted: false, archived: false },
  ]);
  assert.equal((await cache.resolveTypeName("piano", { includeArchived: true })).id, "new");
});

test("a type missing from a list read a while ago is looked for again, once; a fresh list is not re-read", async (t) => {
  let types = TYPES.filter((x) => x.name !== "Sleep");
  const fetchImpl = mockFetch({ "/api/types": () => types });
  const cache = createTypesCache(createApi({ token: "t", baseUrl: "https://mock.test", fetch: fetchImpl }));
  const reads = () => fetchImpl.calls.filter((c) => c.path === "/api/types").length;
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });

  await cache.getTypes();
  types = TYPES; // Sleep was just added in the app
  Date.now = () => realNow() + 10_000;
  assert.equal((await cache.resolveTypeName("Sleep")).id, "t3");
  assert.equal(reads(), 2);

  await assert.rejects(cache.resolveTypeName("Nope"), UsageError);
  await assert.rejects(cache.resolveTypeById("nope"), UsageError);
  assert.equal(reads(), 2, "the list was just read: a miss is a miss");
});
