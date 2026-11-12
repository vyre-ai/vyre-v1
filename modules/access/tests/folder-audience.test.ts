// A folder can be cut off from the Space the way a record can (lane f-revoke, 12 Nov 2026): access audience "added" on a folder stops the Space's roles flowing down to it, keeps its owner and
// the Space's owners and admins, and is set by whoever manages the folder or by the host's own sweep. "Only me" and the record type's export and outside settings are not a folder's. The host may
// write a chat's grants (source chat:<thread>) only on that chat's own agents and their files folders; on anything else it is a delegation like anyone's.
import test from "node:test";
import assert from "node:assert/strict";
import { putPrincipal } from "../handlers/roles.ts";
import { audienceSet, share } from "../handlers/share.ts";
import type { ShareCtx } from "../handlers/share.ts";
import { MemoryDb } from "../fixtures/db.ts";
import { kernelResource, storeOf } from "../projections.ts";

const NOW = 1_700_000_000_000;
const AGENT = "agt_helper", HOME = "fld_helper", OTHER = "fld_other", T = "chat:thr_t";

function rig() {
  const db = new MemoryDb();
  const base: ShareCtx = { space: "spc_test", principal: { kind: "person", id: "usr_ada" }, trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => NOW, db, emit() {} };
  const store = storeOf(base);
  for (const id of ["usr_ada", "usr_bea", "usr_cy"]) { putPrincipal(store, { id, kind: "person", name: id }); store.setRoles(id, [id === "usr_ada" ? "rol_owner" : "rol_member"]); }
  putPrincipal(store, { id: AGENT, kind: "agent", name: "Helper" });
  putPrincipal(store, { id: "svc_host", kind: "service", name: "Vyre" } as never);
  store.resources.set("spc_test", { id: "spc_test", type: "space", parentId: null, label: "public", ownerId: "usr_ada", holds: 0 });
  store.resources.set(AGENT, { id: AGENT, type: "agent", parentId: "spc_test", label: "public", ownerId: "usr_ada", holds: 0 });
  store.resources.set(HOME, { id: HOME, type: "folder", parentId: "spc_test", label: "public", ownerId: "usr_ada", holds: 0 });
  store.resources.set(OTHER, { id: OTHER, type: "folder", parentId: "spc_test", label: "public", ownerId: "usr_ada", holds: 0 });
  // the agent's home grant on its own folder (host/src/gateway/principals.ts agentGrantId), and the grant the chat gave its reader on the agent
  store.grants.set(`gnt_${AGENT.slice(4)}home`, { id: `gnt_${AGENT.slice(4)}home`, subject: { kind: "agent", id: AGENT }, resource: { type: "folder", id: HOME }, level: "edit", conditions: {}, by: "usr_ada", createdAt: NOW });
  store.grants.set("gnt_seen", { id: "gnt_seen", subject: { kind: "person", id: "usr_bea" }, resource: { type: "agent", id: AGENT }, level: "view", conditions: {}, by: "usr_ada", source: T, createdAt: NOW });
  store.bump();
  const as = (principal: ShareCtx["principal"]): ShareCtx => ({ ...base, principal });
  return { base, store, as };
}

test("a folder set to Only people added is cut off from the Space, and the Space's owners and admins keep Manage", async () => {
  const { base, store } = rig();
  assert.equal(kernelResource(store.resources.get(HOME)!).parent_id, "spc_test", "open: it sits under the Space");
  const r = await audienceSet(base, { resource: { type: "folder", id: HOME }, audience: "added" });
  assert.equal(r.audience, "added");
  const row = kernelResource(store.resources.get(HOME)!);
  assert.equal(row.parent_id, null, "cut: no role on the Space reaches it");
  assert.equal(row.home, "spc_test", "it still says where it lives");
  const keepers = [...store.grants.values()].filter((g) => g.resource.id === HOME && g.source === "audience").map((g) => `${g.subject.id}:${g.level}`).sort();
  assert.deepEqual(keepers, ["rol_admin:manage", "rol_owner:manage"]);
  await audienceSet(base, { resource: { type: "folder", id: HOME }, audience: "space" });
  assert.equal(kernelResource(store.resources.get(HOME)!).parent_id, "spc_test", "open again");
  assert.equal([...store.grants.values()].some((g) => g.resource.id === HOME && g.source === "audience"), false, "and the keepers' grants go with the cut");
});

test("a folder is open to the Space or to people added: Only me, exporters and outside are refused", async () => {
  const { base } = rig();
  for (const input of [{ audience: "me" }, { exporters: "viewers" }, { outside: true }] as const) {
    await assert.rejects(() => audienceSet(base, { resource: { type: "folder", id: HOME }, ...input } as never), (e: unknown) => /bad_input/.test(JSON.stringify(e)), JSON.stringify(input));
  }
});

test("who may close a folder: whoever manages it, and the host's sweep; a member who does not manage it is refused", async () => {
  const { as } = rig();
  await assert.rejects(() => audienceSet(as({ kind: "person", id: "usr_cy" }), { resource: { type: "folder", id: HOME }, audience: "added" }), (e: unknown) => /permission/.test(JSON.stringify(e)));
  const r = await audienceSet(as({ kind: "service", id: "svc_host" } as never), { resource: { type: "folder", id: HOME }, audience: "added" });
  assert.equal(r.audience, "added");
  // any other folder: the host is a caller like anyone, and holds no Manage on it
  await assert.rejects(() => audienceSet(as({ kind: "service", id: "svc_host" } as never), { resource: { type: "folder", id: OTHER }, audience: "added" }), (e: unknown) => /permission/.test(JSON.stringify(e)), "the host may not close a folder that is not a chat's own agent's");
});

test("the host writes a chat's grant on that chat's agent and on the agent's own folder, and nowhere else", async () => {
  const { as, store } = rig();
  const host = as({ kind: "service", id: "svc_host" } as never);
  const cy = { kind: "person", id: "usr_cy" } as const;
  await share(host, { resource: { type: "agent", id: AGENT }, subject: cy, level: "view", source: T, idempotencyKey: "h1" } as never);
  await share(host, { resource: { type: "folder", id: HOME }, subject: cy, level: "edit", source: T, idempotencyKey: "h2" } as never);
  const got = [...store.grants.values()].filter((g) => g.subject.id === "usr_cy").map((g) => `${g.resource.id}:${g.level}:${g.source}`).sort();
  assert.deepEqual(got, [`${AGENT}:use:${T}`, `${HOME}:edit:${T}`], "an agent's View is Use");
  await assert.rejects(() => share(host, { resource: { type: "folder", id: OTHER }, subject: cy, level: "edit", source: T, idempotencyKey: "h3" } as never), "a folder that is not the chat's agent's own is a delegation like anyone's");
  await assert.rejects(() => share(host, { resource: { type: "folder", id: HOME }, subject: cy, level: "edit", source: "chat:thr_other", idempotencyKey: "h4" } as never), "another chat's source does not qualify");
});
