// Sharing an agent at the three levels of the Share sheet (owner, 4 Nov): Can use (an old Can chat with / view grant is Use), Can edit, Can manage. Sharing is the fourth level's;
// a person cannot give more than they hold; a person's Assistant (and an outside agent they connected) is theirs alone and cannot be shared at all.
import test from "node:test";
import assert from "node:assert/strict";
import { share, sharesOf, unshare } from "../handlers/share.ts";
import type { ShareCtx } from "../handlers/share.ts";
import { applyEvent } from "../consumers.ts";
import { putPrincipal } from "../handlers/roles.ts";
import { MemoryDb } from "../fixtures/db.ts";
import { EVERYONE, storeOf } from "../projections.ts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** The access tables' in-memory SQL (modules/access/fixtures/db.ts). */
class SqlDb extends MemoryDb {}

function rig() {
  const db = new SqlDb();
  const events: { name: string; subject: string; payload: unknown }[] = [];
  let clock = NOW;
  const ctx: ShareCtx = {
    space: "spc_test", principal: { kind: "person", id: "usr_admin" }, trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock, db, emit(name, subject, payload) { events.push({ name, subject, payload }); },
  };
  const store = storeOf(ctx);
  const everyone = store.groups.get(EVERYONE)!;
  for (const id of ["usr_admin", "usr_a", "usr_b", "usr_c"]) {
    putPrincipal(store, { id, kind: "person", name: id });
    store.setRoles(id, [id === "usr_admin" ? "rol_owner" : "rol_member"]);
    everyone.members.push({ kind: "person", id });
  }
  store.bump();
  const as = (id: string): ShareCtx => ({ ...ctx, principal: { kind: "person", id } });
  const item = (id: string, owner: string | null, type = "site", extra: Record<string, unknown> = {}) => {
    store.resources.set(id, { id, type, parentId: null, label: "public", ownerId: owner, holds: 0, row: { title: id, ...extra } });
    store.bump();
  };
  return { db, ctx, events, store, as, item, tick(ms: number) { clock += ms; }, names: () => events.map((e) => e.name) };
}

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as { error?: { code?: string } }).error?.code ?? "no code"; }
  return "no error";
}
const viaOf = (r: ReturnType<typeof rig>, person: string, id: string, type = "site") => myAccess(r.ctx, person).find((x) => x.id === id && x.type === type);


const who = (id: string) => ({ kind: "person" as const, id });
const agentRef = (id: string) => ({ type: "agent" as const, id });

test("an agent is shared at Can use, Can edit and Can manage (Can chat with was merged into Can use; an old view grant reads as use), and the person who owns it or manages it can share it", async () => {
  const r = rig();
  r.item("agt_ember", "usr_a", "agent");
  for (const level of ["view", "use", "edit", "manage"] as const) {
    const { grant } = await share(r.as("usr_a"), { resource: agentRef("agt_ember"), subject: who("usr_b"), level });
    assert.equal(grant.level, level === "view" ? "use" : level, "view is stored as use");
  }
  assert.equal([...r.store.grants.values()].filter((g) => g.resource.id === "agt_ember").length, 1, "one grant, raised level by level");
  // a manager shares on
  await share(r.as("usr_a"), { resource: agentRef("agt_ember"), subject: who("usr_c"), level: "manage" });
  await share(r.as("usr_c"), { resource: agentRef("agt_ember"), subject: who("usr_admin"), level: "use" });
  assert.equal((await sharesOf(r.as("usr_a"), { resource: agentRef("agt_ember") })).shares.length, 4, "the owner, b, c and the admin");
});

test("only Can manage shares an agent: a person with Can edit, Can use or Can chat with is refused", async () => {
  const r = rig();
  r.item("agt_ember", "usr_a", "agent");
  for (const level of ["view", "use", "edit"] as const) {
    await share(r.as("usr_a"), { resource: agentRef("agt_ember"), subject: who("usr_b"), level });
    assert.equal(await code(share(r.as("usr_b"), { resource: agentRef("agt_ember"), subject: who("usr_c"), level: "view" })), "permission.no_grant", level);
  }
  assert.equal([...r.store.grants.values()].some((g) => g.subject.id === "usr_c"), false);
  // a stranger does not even see it
  assert.equal(await code(share(r.as("usr_c"), { resource: agentRef("agt_ember"), subject: who("usr_c"), level: "view" })), "permission.no_grant");
});

test("a person cannot give more than they have: an editor of a site cannot give Manage, and nothing is left behind", async () => {
  const r = rig();
  r.item("sit_x", "usr_a");
  await share(r.as("usr_a"), { resource: { type: "site", id: "sit_x" }, subject: who("usr_c"), level: "edit" });
  assert.equal(await code(share(r.as("usr_c"), { resource: { type: "site", id: "sit_x" }, subject: who("usr_b"), level: "manage" })), "permission.not_contained");
  assert.equal([...r.store.grants.values()].some((g) => g.subject.id === "usr_b"), false);
});

test("a person's Assistant (and an outside agent they connected) can never be shared: the owner and an admin are told so in words", async () => {
  const r = rig();
  putPrincipal(r.store, { id: "agt_assistant", kind: "agent", name: "Assistant", owner: "usr_a" } as never);
  r.item("agt_assistant", "usr_a", "agent");
  applyEvent(r.store, { seq: 1, type: "agent.privacy_set", payload: { agentId: "agt_assistant", ownerId: "usr_a", private: true } }, 1);
  for (const level of ["view", "use", "edit", "manage"] as const) {
    assert.equal(await code(share(r.as("usr_a"), { resource: agentRef("agt_assistant"), subject: who("usr_b"), level })), "validation.precondition_failed", level);
  }
  await assert.rejects(() => share(r.ctx, { resource: agentRef("agt_assistant"), subject: who("usr_b"), level: "view" }), (e: { error?: { message?: string } }) => /private/i.test(e.error?.message ?? "") && /yours alone/.test(e.error?.message ?? ""));
  assert.equal([...r.store.grants.values()].some((g) => g.resource.id === "agt_assistant"), false, "no grant exists");
  // a shared agent of the same owner is unaffected
  r.item("agt_docs", "usr_a", "agent");
  await share(r.as("usr_a"), { resource: agentRef("agt_docs"), subject: who("usr_b"), level: "view" });
  // and when it stops being private (it was only marked) sharing is open again
  applyEvent(r.store, { seq: 2, type: "agent.privacy_set", payload: { agentId: "agt_assistant", ownerId: "usr_a", private: false } }, 1);
  await share(r.as("usr_a"), { resource: agentRef("agt_assistant"), subject: who("usr_b"), level: "view" });
});

test("access given to an agent for one chat is taken back by its source, and only that source", async () => {
  const r = rig();
  r.item("fld_deed", "usr_a", "folder");
  r.item("thr_deed", "usr_a", "thread");
  putPrincipal(r.store, { id: "agt_cc", kind: "agent", name: "Claude Code", owner: "usr_a" } as never);
  const agent = { kind: "agent" as const, id: "agt_cc" };
  await share(r.as("usr_a"), { resource: { type: "thread", id: "thr_deed" }, subject: agent, level: "use", source: "chat:thr_deed" });
  await share(r.as("usr_a"), { resource: { type: "folder", id: "fld_deed" }, subject: agent, level: "edit", source: "chat:thr_deed" });
  await share(r.as("usr_a"), { resource: { type: "folder", id: "fld_deed" }, subject: agent, level: "view", source: "chat:thr_other" });
  const out = await unshare(r.as("usr_a"), { resource: { type: "folder", id: "fld_deed" }, subject: agent, source: "chat:thr_deed" });
  assert.equal(out.revoked, 1);
  assert.deepEqual([...r.store.grants.values()].filter((g) => g.subject.id === "agt_cc").map((g) => [g.resource.id, g.source]).sort(), [["fld_deed", "chat:thr_other"], ["thr_deed", "chat:thr_deed"]]);
});
