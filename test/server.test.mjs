import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAtlServer } from "../dist/server.js";
import { mockCtx } from "./helpers.mjs";

const READ_TOOLS = ["app_help", "get_current_status", "list_activity_types", "list_intervals", "time_report"];
const WRITE_TOOLS = ["log_interval", "pause_resume_activity", "start_activity", "stop_activity", "update_activity", "update_interval"];

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
  assert.deepEqual(destructive.sort(), ["update_activity", "update_interval"], "only replacing a comment, tags or an entry's times overwrites anything");
});

test("the tools act on the account they were given", async () => {
  const client = await connect({}, { "GET /api/activities": { activities: [{ id: "a9", typeId: "t3", status: "PAUSED", duration: 60 }] } });
  const r = await client.callTool({ name: "get_current_status", arguments: { timezone: "UTC" } });
  assert.deepEqual(JSON.parse(r.content[0].text).active.map((a) => a.activity), ["Sleep"]);
  await client.close();
});

test("the instructions point at update_interval for fixing times, and no longer say times cannot be edited", async () => {
  const { instructions } = await listTools({});
  assert.match(instructions, /update_interval moves a past entry/);
  assert.doesNotMatch(instructions, /times cannot be edited/i);
  assert.match(instructions, /Entries cannot be deleted/);
});

test("update_interval tells the model that a paused timer's stretches can be moved", async () => {
  const { tools } = await listTools({});
  const tool = tools.find((t) => t.name === "update_interval");
  assert.match(tool.description, /stretches of a paused timer are entries like any other and can be moved/);
});
