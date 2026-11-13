// A Shared item an agent made is the agent's. That standing lets it work with the item for nobody, or for the people who hold it; asked by someone who holds nothing on it, the agent does not hand them
// the item, its use, its fill or its metadata (lib/agent-asker.ts). Rob is such a person here.
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import { AGENT, MAYA, ROB, SECRET, harness, refusedWith } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;

test("an item owned by an agent is not reachable for Rob who asks that agent, but is for the agent acting for nobody", async () => {
  const h = harness();
  const folderId = String(out(out(await v.foldersCreate(h.ctx, { name: "Team keys", scope: "shared", idempotencyKey: "f1" })).folder).id);
  const itemId = String(out(out(await v.itemPut(h.ctx, { folderId, name: "Agent key", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "p1" } as Parameters<typeof v.itemPut>[1])).item).id);
  // the item came to be the agent's (an agent made it while working)
  h.ctx.db.run(`UPDATE vault_meta SET "owner" = ? WHERE "id" = ?`, AGENT, itemId);
  h.actAs("agent", AGENT);
  (h.ctx as { actingFor?: string }).actingFor = ROB;
  assert.equal(await refusedWith(v.itemGet(h.ctx, { itemId })), "permission.no_grant", "Rob, through the agent, gets the item's metadata");
  assert.ok((await v.itemsList(h.ctx, {} as never).then((r) => JSON.stringify(r), () => "")).includes("Agent key") === false, "and does not find it in a list");
  (h.ctx as { actingFor?: string }).actingFor = undefined;
  assert.equal(String(out(out(await v.itemGet(h.ctx, { itemId })).item).id), itemId, "the agent acting for nobody still works with its own item");
  void MAYA;
});
