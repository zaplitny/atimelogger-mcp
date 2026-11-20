import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAtlServer } from "../dist/server.js";
import { mockCtx } from "./helpers.mjs";

const READ_TOOLS = ["app_help", "get_current_status", "list_activity_types", "list_intervals", "time_report"];
const WRITE_TOOLS = ["archive_activity_type", "log_interval", "pause_resume_activity", "start_activity", "stop_activity", "update_activity", "update_interval"];

async function connect(options, routes) {
  const server = createAtlServer({ version: "test", ctx: mockCtx(routes).ctx, ...options });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

async function listTools(options) {
  const client = await connect(options);
  const { tools } = await client.listTools();
  const instructions = client.getInstructions();
  await client.close();
  return { tools, instructions };
}

test("the full server registers the read and the write tools", async () => {
  const { tools, instructions } = await listTools({});
  assert.deepEqual(tools.map((t) => t.name).sort(), [...READ_TOOLS, ...WRITE_TOOLS].sort());
  assert.match(instructions, /start_activity/);
  assert.doesNotMatch(instructions, /can only read/);
});

test("without write access only the read tools exist, and the instructions say so", async () => {
  const { tools, instructions } = await listTools({ write: false });
  assert.deepEqual(tools.map((t) => t.name).sort(), READ_TOOLS);
  assert.match(instructions, /can only read/);
  assert.doesNotMatch(instructions, /start_activity/);
});

test("every tool has a title and states all three hints", async () => {
  const { tools } = await listTools({});
  for (const tool of tools) {
    assert.ok(tool.title, `${tool.name} has a title`);
    for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
      assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name} states ${hint}`);
    }
    assert.equal(tool.annotations.readOnlyHint, READ_TOOLS.includes(tool.name), `${tool.name} readOnlyHint`);
    assert.equal(tool.annotations.openWorldHint, false, `${tool.name} reaches only the user's own data or the docs`);
  }
  const destructive = tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
  assert.deepEqual(destructive.sort(), ["archive_activity_type", "update_activity", "update_interval"],
    "replacing a comment, tags or an entry's times overwrites something; archiving takes a type out of use");
});

test("the tools act on the account they were given", async () => {
  const client = await connect({}, { "GET /api/activities": { activities: [{ id: "a9", typeId: "t3", status: "PAUSED", duration: 60 }] } });
  const r = await client.callTool({ name: "get_current_status", arguments: { timezone: "UTC" } });
  assert.deepEqual(JSON.parse(r.content[0].text).active.map((a) => a.activity), ["Sleep"]);
  await client.close();
});

test("the instructions point at update_interval for fixing times, and no longer say times cannot be edited", async () => {
  const { instructions } = await listTools({});
  assert.match(instructions, /update_interval moves an entry's start and\/or end/);
  assert.match(instructions, /or when a running timer started/);
  assert.doesNotMatch(instructions, /times cannot be edited/i);
  assert.match(instructions, /Entries cannot be deleted/);
});

test("update_interval tells the model that a paused timer's stretches can be moved", async () => {
  const { tools } = await listTools({});
  const tool = tools.find((t) => t.name === "update_interval");
  assert.match(tool.description, /stretches of a paused timer are entries like any other and can be moved/);
});

test("update_interval can move a running timer's start, so interval_id is optional", async () => {
  const { tools } = await listTools({});
  const tool = tools.find((t) => t.name === "update_interval");
  assert.match(tool.description, /when a running timer started/);
  assert.match(tool.description, /stop_activity/, "and says how to end one in the past instead");
  assert.deepEqual(tool.inputSchema.required, ["activity_id"]);
});

test("moving a running timer's start answers with when it now runs since", async () => {
  const today = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const client = await connect({}, {
    "GET /api/activities/a7": { id: "a7", typeId: "t1", status: "RUNNING", duration: 0, start: `${today}T00:20:00.000Z`, intervals: [] },
    "PATCH /api/activities/a7/start": () => new Response(null, { status: 204 }),
  });
  const r = await client.callTool({ name: "update_interval", arguments: { activity_id: "a7", from: "00:15", timezone: "UTC" } });
  await client.close();
  const text = JSON.parse(r.content[0].text);
  assert.deepEqual(Object.keys(text), ["moved", "running_since", "timezone", "elapsed"]);
  assert.deepEqual([text.moved, text.running_since, text.timezone], ["Development", `${today} 00:15`, "UTC"]);
});

test("archive_activity_type comes with the write tools, and can be undone", async () => {
  const { tools, instructions } = await listTools({});
  const tool = tools.find((t) => t.name === "archive_activity_type");
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.destructiveHint, true, "archiving takes a type out of use, even though it can be restored");
  assert.equal(tool.annotations.idempotentHint, true);
  assert.match(instructions, /archive_activity_type/);
  assert.doesNotMatch((await listTools({ write: false })).instructions, /archive_activity_type/);
});
