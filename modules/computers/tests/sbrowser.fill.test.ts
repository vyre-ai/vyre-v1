// The Vault channel for Vyre for Chrome inside a Space browser profile: the extension asks which items fit a page and for a handle to one, as the profile's agent, through the same endpoint and token
// that fills a #Handle.field (handlers/fill.ts). Only those two capabilities, only with the profile's own token and name, and never a value.
import test from "node:test";
import assert from "node:assert/strict";
import { createFillService, FILL_INVOKE } from "../handlers/fill.ts";
import type { FillSource } from "../handlers/fill.ts";

function rig(invoke?: FillSource["invoke"]) {
  const asked: Array<{ cap: string; input: Record<string, unknown>; who: { agentId: string; asker: string } }> = [];
  const source: FillSource = {
    async lookup() { return { kind: "unknown" }; },
    ...(invoke ? { invoke } : { invoke: async (cap, input, who) => { asked.push({ cap, input, who }); return { items: [{ item: { itemId: "itm_1", name: "Login" }, usernameField: "username" }] }; } }),
  };
  const service = createFillService({ source, log: () => {} });
  return { service, asked, source };
}
const post = (service: ReturnType<typeof createFillService>, token: string, body: unknown, secure?: boolean) => service.serve({ authorization: `Bearer ${token}`, body, ...(secure !== undefined ? { secure } : {}) });

test("the extension in a profile asks which items fit a page, as that profile's agent for the person who asked", async () => {
  const r = rig();
  const g = await r.service.issue({ computerId: "agt_dex", agentId: "agt_dex", asker: "usr_dana" });
  const out = await post(r.service, g.fillToken, { op: "invoke", computerId: "agt_dex", capability: "vault.items.match", input: { url: "https://app.example.com" } });
  assert.equal(out.status, 200);
  assert.deepEqual((out.body["output"] as { items: unknown[] }).items.length, 1);
  assert.deepEqual(r.asked, [{ cap: "vault.items.match", input: { url: "https://app.example.com" }, who: { agentId: "agt_dex", asker: "usr_dana" } }]);
  assert.equal((await post(r.service, g.fillToken, { op: "invoke", computerId: "agt_dex", capability: "vault.use", input: { item: "itm_1" } })).status, 200);
});

test("only the two Vault capabilities, only with the profile's own token and name, and a link that is not private is refused for a server that joined", async () => {
  const r = rig();
  const g = await r.service.issue({ computerId: "agt_dex", agentId: "agt_dex", asker: "usr_dana" });
  assert.deepEqual([...FILL_INVOKE], ["vault.items.match", "vault.use"]);
  for (const capability of ["vault.fill", "vault.item.put", "vault.share", "files.list", "records.delete", "agents.delete", "", "vault.items.match; x"]) {
    assert.equal((await post(r.service, g.fillToken, { op: "invoke", computerId: "agt_dex", capability, input: {} })).status, 400, capability);
  }
  for (const input of [null, "x", [1], undefined]) assert.equal((await post(r.service, g.fillToken, { op: "invoke", computerId: "agt_dex", capability: "vault.use", input })).status, 400);
  assert.equal((await post(r.service, g.fillToken, { op: "invoke", computerId: "agt_scout", capability: "vault.use", input: {} })).status, 403, "another profile's name");
  assert.equal((await post(r.service, "wrong-token-wrong-token", { op: "invoke", computerId: "agt_dex", capability: "vault.use", input: {} })).status, 401);
  assert.equal(r.asked.length, 0, "nothing refused reached the Vault");
  const node = await r.service.issue({ computerId: "agt_node", agentId: "agt_node", asker: "usr_dana", nodeId: "nod_1" });
  assert.equal((await post(r.service, node.fillToken, { op: "invoke", computerId: "agt_node", capability: "vault.use", input: {} }, false)).status, 403, "not over a link that is not private");
  assert.equal((await post(r.service, node.fillToken, { op: "invoke", computerId: "agt_node", capability: "vault.use", input: {} }, true)).status, 200);
});

test("a source that cannot answer is a 404 so the extension finds nothing; a refusal or a fault never carries the original error", async () => {
  const none = createFillService({ source: { async lookup() { return { kind: "unknown" }; } }, log: () => {} });
  const g1 = await none.issue({ computerId: "agt_dex", agentId: "agt_dex", asker: "usr_dana" });
  assert.equal((await post(none, g1.fillToken, { op: "invoke", computerId: "agt_dex", capability: "vault.use", input: {} })).status, 404);
  const denied = rig(async () => { throw { error: { code: "permission.no_grant", message: "secret detail" } }; });
  const g2 = await denied.service.issue({ computerId: "agt_dex", agentId: "agt_dex", asker: "usr_dana" });
  const d = await post(denied.service, g2.fillToken, { op: "invoke", computerId: "agt_dex", capability: "vault.use", input: {} });
  assert.deepEqual([d.status, d.body], [403, { code: "forbidden" }]);
  const broke = rig(async () => { throw new Error("db password is hunter2"); });
  const g3 = await broke.service.issue({ computerId: "agt_dex", agentId: "agt_dex", asker: "usr_dana" });
  const b = await post(broke.service, g3.fillToken, { op: "invoke", computerId: "agt_dex", capability: "vault.use", input: {} });
  assert.deepEqual([b.status, b.body], [503, { code: "unavailable" }]);
  assert.ok(!JSON.stringify(b).includes("hunter2"));
});
