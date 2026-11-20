import test from "node:test";
import assert from "node:assert/strict";
import { archiveType, listTypes } from "../dist/tools/types.js";
import { UsageError } from "../dist/errors.js";
import { mockCtx, TYPES } from "./helpers.mjs";

/** A backend that keeps the archived flag PATCHed onto its types, like atl. */
function backend(initial = TYPES) {
  const types = initial.map((t) => ({ ...t }));
  const { ctx, calls } = mockCtx({
    "GET /api/types": () => types,
    "PATCH /api/types/t1/archived": ({ body }) => archive("t1", body),
    "PATCH /api/types/t3/archived": ({ body }) => archive("t3", body),
    "PATCH /api/types/t4/archived": ({ body }) => archive("t4", body),
    "PATCH /api/types/g1/archived": ({ body }) => archive("g1", body),
  });
  function archive(id, body) {
    types.find((t) => t.id === id).archived = body.archived;
    return new Response(null, { status: 204 });
  }
  return { ctx, calls, patches: () => calls.filter((c) => c.method === "PATCH").map((c) => [c.path, c.body]) };
}

test("archives a type by name, and it no longer resolves for starting", async () => {
  const { ctx, patches } = backend();
  await ctx.types.getTypes(); // warm the 60 s cache: archiving must not leave it stale
  const t = await archiveType({ type: "sleep" }, ctx);
  assert.deepEqual(t, { name: "Sleep", id: "t3", group: false, archived: true });
  assert.deepEqual(patches(), [["/api/types/t3/archived", { archived: true }]]);
  await assert.rejects(ctx.types.resolveTypeName("Sleep"), UsageError);
});

test("restores an archived type by name, matching only archived ones", async () => {
  const { ctx, patches } = backend();
  const t = await archiveType({ type: "retired", restore: true }, ctx);
  assert.deepEqual(t, { name: "Retired", id: "t4", group: false, archived: false });
  assert.deepEqual(patches(), [["/api/types/t4/archived", { archived: false }]]);
  assert.equal((await ctx.types.resolveTypeName("Retired")).id, "t4");

  await assert.rejects(archiveType({ type: "sleep", restore: true }, ctx), /No archived activity type matches "sleep"/);
});

test("a group can be archived; the types inside it are left alone", async () => {
  const { ctx, patches } = backend();
  const t = await archiveType({ type: "Work" }, ctx);
  assert.equal(t.group, true);
  assert.deepEqual(patches(), [["/api/types/g1/archived", { archived: true }]]);
});

test("by id: archives the exact type; restoring one that is not archived says so", async () => {
  const { ctx, patches } = backend();
  assert.equal((await archiveType({ type_id: "t1" }, ctx)).name, "Development");
  await assert.rejects(archiveType({ type_id: "t3", restore: true }, ctx), /"Sleep" is not archived/);
  assert.deepEqual(patches(), [["/api/types/t1/archived", { archived: true }]]);
});

test("archiving what is already archived is no error: atl leaves it as it is", async () => {
  const { ctx, patches } = backend();
  const t = await archiveType({ type_id: "t4" }, ctx);
  assert.equal(t.archived, true);
  assert.deepEqual(patches(), [["/api/types/t4/archived", { archived: true }]]);
});

test("a company category is refused without a request", async () => {
  const { ctx, patches } = backend([...TYPES, { id: "c1", name: "Client work", group: false, parentId: null, deleted: false, archived: false, readOnly: true }]);
  await assert.rejects(archiveType({ type: "client work" }, ctx), /only the company can archive it/);
  assert.deepEqual(patches(), []);
});

test("without a type or type_id it asks for one", async () => {
  const { ctx } = backend();
  await assert.rejects(archiveType({}, ctx), UsageError);
  await assert.rejects(archiveType({ type: "  " }, ctx), UsageError);
});

test("the type list asks atl for archived types, so include_archived shows them", async () => {
  const { ctx, calls } = backend();
  const all = await listTypes(true, ctx);
  assert.equal(calls[0].search, "?includeArchived=true");
  assert.ok(all.types.some((t) => t.name === "Retired" && t.archived === true));
  assert.ok(!(await listTypes(false, ctx)).types.some((t) => t.name === "Retired"));
});
