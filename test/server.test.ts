import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.ts";

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([buildServer().connect(a), client.connect(b)]);
  return client;
}

test("exposes the expected tools", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "audit_account", "check_account_setup", "create_messages_campaign_draft", "create_warm_audiences",
    "estimate_leads", "get_results", "list_ad_accounts", "run_guard", "search_location", "set_status",
  ]);
});

test("write tools refuse while ENABLE_WRITES is off", async () => {
  const client = await connect();
  const r: any = await client.callTool({ name: "set_status", arguments: { object_id: "1", status: "PAUSED" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /ENABLE_WRITES/);
});

test("estimate_leads works offline with a CPL override", async () => {
  const client = await connect();
  const r: any = await client.callTool({ name: "estimate_leads", arguments: { budget_inr: 500, cpl_override_inr: 40 } });
  assert.equal(r.isError, undefined);
  assert.equal(JSON.parse(r.content[0].text).leads.expected, 13);
});
