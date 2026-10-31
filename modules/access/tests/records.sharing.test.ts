// Records sharing (DESIGN-records-sharing): who a type or a record is open to, the export right a grant can carry, and a record that differs from its type.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import { putPrincipal } from "../handlers/roles.ts";
import { audienceSet, recordMarks, share, sharesOf, unshare } from "../handlers/share.ts";
import type { ShareCtx } from "../handlers/share.ts";
import { MemoryDb } from "../fixtures/db.ts";
import { EVERYONE, storeOf } from "../projections.ts";

const NOW = 1_700_000_000_000;

function rig() {
  const db = new MemoryDb();
  const events: { name: string; payload: unknown }[] = [];
  const ctx: ShareCtx = {
    space: "spc_test", principal: { kind: "person", id: "usr_ada" }, trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => NOW, db, emit(name, _subject, payload) { events.push({ name, payload }); },
  };
  const store = storeOf(ctx);
  const everyone = store.groups.get(EVERYONE)!;
  for (const id of ["usr_ada", "usr_bea", "usr_cal", "usr_dee"]) {
    putPrincipal(store, { id, kind: "person", name: id });
    store.setRoles(id, [id === "usr_ada" ? "rol_owner" : "rol_member"]);
    everyone.members.push({ kind: "person", id });
  }
  store.resources.set("spc_test", { id: "spc_test", type: "space", parentId: null, label: "public", ownerId: "usr_ada", holds: 0 });
  store.resources.set("deal", { id: "deal", type: "record_type", parentId: "spc_test", label: "public", ownerId: "usr_ada", holds: 0 });
  for (const id of ["rec_one", "rec_two"]) store.resources.set(id, { id, type: "record", parentId: "deal", label: "public", ownerId: "usr_ada", holds: 0 });
  // what the host adds to every snapshot: the roles' standard level on the Space
  store.grants.set("gnt_owner", { id: "gnt_owner", subject: { kind: "role", id: "rol_owner" }, resource: { type: "space", id: "spc_test" }, level: "manage", conditions: {}, by: "svc_host", createdAt: 1 });
  store.grants.set("gnt_member", { id: "gnt_member", subject: { kind: "role", id: "rol_member" }, resource: { type: "space", id: "spc_test" }, level: "edit", conditions: {}, by: "svc_host", createdAt: 1 });
  store.bump();
  const as = (id: string): ShareCtx => ({ ...ctx, principal: { kind: "person", id } });
  const can = (who: string, resource: { type: string; id: string }, level: "view" | "edit" | "manage" = "view", perm: string | null = null): boolean =>
    authorize(store.snapshot(), { principal: who, action: { perm, level }, resource, now: NOW }).effect === "allow";
  return { ctx, store, as, can, events };
}
const deal = { type: "record_type", id: "deal" };
const one = { type: "record", id: "rec_one" };
const person = (id: string) => ({ kind: "person" as const, id });
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as { error?: { code?: string } }).error?.code ?? "no code"; }
  return "no error";
}

test("Only people added cuts a type off from the Space: the others lose it, admins and the people added keep it", async () => {
  const r = rig();
  assert.ok(r.can("usr_dee", deal) && r.can("usr_dee", one), "a member sees it through the Space");
  assert.deepEqual(await audienceSet(r.ctx, { resource: deal, audience: "added" }), { audience: "added", exporters: "admins", outside: false });
  assert.ok(!r.can("usr_dee", deal) && !r.can("usr_dee", one), "Dee was not added");
  assert.ok(r.can("usr_ada", deal) && r.can("usr_ada", one, "manage"));
  await share(r.ctx, { resource: deal, subject: person("usr_bea"), level: "edit" });
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view" });
  assert.ok(r.can("usr_bea", one, "edit"), "Bea edits a deal");
  assert.ok(r.can("usr_cal", one) && !r.can("usr_cal", one, "edit"), "Cal reads it and cannot edit");
  assert.ok(!r.can("usr_dee", one));
  const of = await sharesOf(r.ctx, { resource: deal });
  assert.equal(of.audience, "added");
  assert.deepEqual(of.shares.filter((x) => x.through === "direct" && x.grant.source === undefined).map((x) => [x.grant.subject.id, x.grant.level]).sort(), [["usr_bea", "edit"], ["usr_cal", "view"]]);
  await audienceSet(r.ctx, { resource: deal, audience: "space" });
  assert.ok(r.can("usr_dee", one), "back to everyone: the Space reaches it again");
  assert.ok(!(await sharesOf(r.ctx, { resource: deal })).shares.some((x) => x.grant.source === "audience"), "the keepers' grants went with the choice");
});

test("export is a right a grant carries, and only from someone who holds it", async () => {
  const r = rig();
  await audienceSet(r.ctx, { resource: deal, audience: "added" });
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view" });
  assert.ok(!r.can("usr_cal", deal, "view", "records.export"), "a member has no export by role");
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view", export: true });
  assert.ok(r.can("usr_cal", deal, "view", "records.export") && r.can("usr_cal", one, "view", "records.export"), "Cal can export what he can see");
  assert.ok(!r.can("usr_cal", deal, "edit"), "export is not edit");
  // changing the level keeps the flag
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "edit" });
  assert.ok(r.can("usr_cal", deal, "edit", "records.export"));
  // Bea may not hand it on: she cannot export, and a member cannot share a type without the right
  await share(r.ctx, { resource: deal, subject: person("usr_bea"), level: "manage" });
  assert.equal(await code(share(r.as("usr_bea"), { resource: deal, subject: person("usr_dee"), level: "view", export: true })), "permission.not_contained");
  await share(r.as("usr_bea"), { resource: deal, subject: person("usr_dee"), level: "view" });
  // the flag is for records only
  r.store.resources.set("sit_x", { id: "sit_x", type: "site", parentId: "spc_test", label: "public", ownerId: "usr_ada", holds: 0 });
  assert.equal(await code(share(r.ctx, { resource: { type: "site", id: "sit_x" }, subject: person("usr_bea"), level: "view", export: true })), "validation.bad_input");
  // taking the flag away
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view", export: false });
  assert.ok(!r.can("usr_cal", deal, "view", "records.export"));
});

test("Anyone who can view may export when the type says so; Admins only takes it and the chosen flags back", async () => {
  const r = rig();
  await audienceSet(r.ctx, { resource: deal, audience: "added" });
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view" });
  await share(r.ctx, { resource: deal, subject: person("usr_bea"), level: "view", export: true });
  assert.equal((await sharesOf(r.ctx, { resource: deal })).exporters, "chosen");
  assert.deepEqual(await audienceSet(r.ctx, { resource: deal, exporters: "viewers" }), { audience: "added", exporters: "viewers", outside: false });
  assert.ok(r.can("usr_cal", deal, "view", "records.export"), "Cal can view, so he exports");
  assert.ok(!r.can("usr_dee", deal, "view", "records.export"), "Dee cannot view, so she does not");
  await audienceSet(r.ctx, { resource: deal, exporters: "admins" });
  assert.ok(!r.can("usr_cal", deal, "view", "records.export") && !r.can("usr_bea", deal, "view", "records.export"));
  assert.equal((await sharesOf(r.ctx, { resource: deal })).exporters, "admins");
  // Chosen people holds as a choice before anyone is chosen, and a flag given later keeps it there
  assert.equal((await audienceSet(r.ctx, { resource: deal, exporters: "chosen" })).exporters, "chosen");
  assert.equal((await sharesOf(r.ctx, { resource: deal })).exporters, "chosen");
  assert.ok(!r.can("usr_cal", deal, "view", "records.export"), "nobody chosen yet");
  assert.equal(await code(audienceSet(r.as("usr_cal"), { resource: deal, exporters: "viewers" })), "permission.no_grant");
});

test("one record can be cut off from its type and put back", async () => {
  const r = rig();
  await audienceSet(r.ctx, { resource: deal, audience: "added" });
  await share(r.ctx, { resource: deal, subject: person("usr_bea"), level: "edit" });
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view" });
  const before = await sharesOf(r.ctx, { resource: one });
  assert.equal(before.inherits, "deal");
  await audienceSet(r.ctx, { resource: one, audience: "me" });
  assert.ok(!r.can("usr_bea", one) && !r.can("usr_cal", one), "Bea and Cal lose the one deal at once");
  assert.ok(r.can("usr_bea", { type: "record", id: "rec_two" }, "edit"), "the others stay");
  assert.ok(r.can("usr_ada", one, "manage"));
  assert.equal((await sharesOf(r.ctx, { resource: one })).audience, "me");
  assert.equal((await sharesOf(r.ctx, { resource: one })).inherits, undefined);
  // the record can still be shared on its own
  await share(r.ctx, { resource: one, subject: person("usr_cal"), level: "view" });
  assert.ok(r.can("usr_cal", one));
  await audienceSet(r.ctx, { resource: one, audience: "space" });
  assert.ok(r.can("usr_bea", one, "edit"), "back to following the type");
  assert.equal((await sharesOf(r.ctx, { resource: one })).inherits, "deal");
});

test("an admin who sets a record to Only me keeps it even when someone else made it", async () => {
  const r = rig();
  r.store.resources.get("rec_two")!.ownerId = "usr_bea";
  r.store.bump();
  await audienceSet(r.ctx, { resource: { type: "record", id: "rec_two" }, audience: "me" });
  assert.ok(r.can("usr_ada", { type: "record", id: "rec_two" }, "manage"));
  assert.ok(r.can("usr_bea", { type: "record", id: "rec_two" }, "manage"), "its owner keeps it");
  assert.ok(!r.can("usr_cal", { type: "record", id: "rec_two" }));
});

test("sharing a record type needs Manage or the right to share it on", async () => {
  const r = rig();
  await audienceSet(r.ctx, { resource: deal, audience: "added" });
  await share(r.ctx, { resource: deal, subject: person("usr_bea"), level: "edit" });
  assert.equal(await code(share(r.as("usr_bea"), { resource: deal, subject: person("usr_cal"), level: "view" })), "permission.no_grant");
  await share(r.ctx, { resource: deal, subject: person("usr_bea"), level: "edit", reshare: true });
  await share(r.as("usr_bea"), { resource: deal, subject: person("usr_cal"), level: "view" });
  assert.ok(r.can("usr_cal", deal));
  assert.equal(await code(share(r.as("usr_bea"), { resource: deal, subject: person("usr_dee"), level: "manage" })), "permission.not_contained");
  const gone = await unshare(r.ctx, { resource: deal, subject: person("usr_cal") });
  assert.equal(gone.revoked, 1);
});

test("record marks name the rows that differ and whether the caller was given the type by name", async () => {
  const r = rig();
  await audienceSet(r.ctx, { resource: deal, audience: "added" });
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view" });
  await audienceSet(r.ctx, { resource: one, audience: "me" });
  await share(r.ctx, { resource: { type: "record", id: "rec_two" }, subject: person("usr_bea"), level: "edit" });
  const ada = await recordMarks(r.ctx, { type: "deal" });
  assert.deepEqual(ada.rows.map((x) => [x.id, x.audience, x.direct]), [["rec_one", "me", 0], ["rec_two", "space", 1]]);
  assert.equal(ada.typeShared, false, "she owns it");
  const cal = await recordMarks(r.as("usr_cal"), { type: "deal" });
  assert.equal(cal.typeShared, true);
  assert.equal(cal.audience, "added");
});

test("the caller's rights come back with the shares, so the app draws Share and Export only for those who can", async () => {
  const r = rig();
  await audienceSet(r.ctx, { resource: deal, audience: "added" });
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view" });
  await share(r.ctx, { resource: deal, subject: person("usr_bea"), level: "edit", reshare: true, export: true });
  assert.deepEqual((await sharesOf(r.ctx, { resource: deal })).can, { manage: true, share: true, export: true });
  assert.deepEqual((await sharesOf(r.as("usr_cal"), { resource: deal })).can, { manage: false, share: false, export: false });
  assert.deepEqual((await sharesOf(r.as("usr_bea"), { resource: one })).can, { manage: false, share: true, export: true });
  assert.deepEqual((await recordMarks(r.as("usr_cal"), { type: "deal" })).can, { manage: false, share: false, export: false });
  assert.equal(await code(recordMarks(r.as("usr_dee"), { type: "deal" })), "permission.no_grant", "Dee was not added, so she is told nothing about the type");
  await share(r.ctx, { resource: deal, subject: person("usr_cal"), level: "view", export: true });
  assert.equal((await recordMarks(r.as("usr_cal"), { type: "deal" })).can.export, true);
});

test("an agent acts with the asker's access, never more: Dee's agent cannot read Deals, Bea's can", async () => {
  const r = rig();
  putPrincipal(r.store, { id: "agt_helper", kind: "agent", name: "Helper", owner: "usr_dee" });
  r.store.setRoles("agt_helper", ["rol_member"]);
  r.store.bump();
  await audienceSet(r.ctx, { resource: deal, audience: "added" });
  await share(r.ctx, { resource: deal, subject: person("usr_bea"), level: "edit" });
  await share(r.ctx, { resource: deal, subject: { kind: "agent", id: "agt_helper" }, level: "edit" });   // an agent can be added to the sheet like a person
  const asks = (asker: string, resource: { type: string; id: string }): boolean =>
    authorize(r.store.snapshot(), { principal: "agt_helper", actingFor: asker, action: { perm: null, level: "view" }, resource, now: NOW }).effect === "allow";
  assert.ok(!asks("usr_dee", deal) && !asks("usr_dee", one), "Dee was not added, so the agent added to the sheet still reads nothing for her");
  assert.ok(asks("usr_bea", deal) && asks("usr_bea", one), "Bea was");
  assert.ok(!authorize(r.store.snapshot(), { principal: "agt_helper", actingFor: "usr_bea", action: { perm: "records.export", level: "view" }, resource: deal, now: NOW }).effect.startsWith("allow"), "and her agent has no export either");
});

test("links outside the Space are off for a type until its sheet turns them on", async () => {
  const r = rig();
  assert.equal((await sharesOf(r.ctx, { resource: deal })).outside, false);
  assert.equal((await audienceSet(r.ctx, { resource: deal, outside: true })).outside, true);
  assert.equal((await sharesOf(r.ctx, { resource: deal })).outside, true);
  assert.equal((await audienceSet(r.ctx, { resource: deal, outside: false })).outside, false);
  assert.equal(await code(audienceSet(r.ctx, { resource: one, outside: true })), "validation.bad_input", "a type setting, not a record's");
});
