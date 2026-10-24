import test from "node:test";
import assert from "node:assert/strict";
import { GrantsStore, ROLE_LEVEL, ROLE_MAY_SET, ROLE_PERMS, ROLE_RANK, maySet } from "../src/grants/index.ts";
import type { GrantEvent, ResourceRef } from "../src/grants/index.ts";

const SYS = { kind: "person" as const, id: "usr_owner" };
const prj: ResourceRef = { type: "project", id: "prj_a" };
const rec: ResourceRef = { type: "record", id: "rec_1" };
const sub = (id: string) => ({ kind: "principal" as const, id });
// rec_1 sits in prj_a, which sits in space spc_1
const ancestors = (r: ResourceRef): ResourceRef[] => (r.id === "rec_1" ? [prj, { type: "space", id: "spc_1" }] : r.id === "prj_a" ? [{ type: "space", id: "spc_1" }] : []);
let T = 1_000_000;
const mk = () => new GrantsStore({ space: "spc_1", clock: () => T, ancestorsOf: ancestors });
const err = (code: string) => (e: unknown) => { assert.equal((e as { code?: string }).code, code, String((e as Error).message)); return true; };

test("create: a grant is level + ResourceRef, frozen, active, and refused when malformed", () => {
  const s = mk();
  const { grant, event } = s.create({ subject: sub("usr_dana"), resource: prj, level: "edit", source: "direct" }, SYS);
  assert.deepEqual([grant.status, grant.level, grant.resource, grant.space], ["active", "edit", prj, "spc_1"]);
  assert.equal(event.type, "grant.created");
  assert.ok(Object.isFrozen(grant));
  assert.throws(() => s.create({ subject: sub("usr_dana"), resource: prj, level: "root" as never, source: "direct" }, SYS), err("bad_input"));
  assert.throws(() => s.create({ subject: sub("usr_dana"), resource: prj, level: "view", source: "" }, SYS), err("bad_input"));
  assert.throws(() => s.create({ subject: { kind: "role", id: "king" }, resource: prj, level: "view", source: "direct" }, SYS), err("bad_input"));
  assert.throws(() => s.create({ subject: sub("usr_dana"), resource: prj, level: "view", source: "direct", conditions: { actions: ["x"] } as never }, SYS), err("bad_input"));
  assert.throws(() => s.create({ subject: sub("usr_dana"), resource: prj, level: "view", source: "direct", expires_at: T - 1 }, SYS), err("bad_input"));
});

test("levelFor: the best level from any active grant on the resource or an ancestor", () => {
  const s = mk();
  s.create({ subject: sub("usr_dana"), resource: prj, level: "use", source: "direct" }, SYS);
  s.create({ subject: sub("usr_dana"), resource: rec, level: "edit", source: "direct" }, SYS);
  assert.equal(s.levelFor(sub("usr_dana"), rec), "edit");
  assert.equal(s.levelFor(sub("usr_dana"), prj), "use");
  assert.equal(s.levelFor(sub("usr_dana"), { type: "project", id: "prj_other" }), null);
  assert.equal(s.levelFor(sub("usr_sam"), rec), null);
});

test("delegation containment: a child stays inside its parent (level, resource, expiry, hidden fields, row filter)", () => {
  const s = mk();
  const parent = s.create({ subject: sub("usr_dana"), resource: prj, level: "edit", source: "direct", expires_at: T + 1000, conditions: { hiddenFields: ["ssn"], rowFilter: { eq: ["owner", "$me"] } } }, SYS).grant;
  const base = { subject: sub("usr_sam"), resource: rec, level: "view" as const, source: "task:t1", parent: parent.id, expires_at: T + 500, conditions: { hiddenFields: ["ssn", "fee"], rowFilter: { and: [{ eq: ["owner", "$me"] }, { eq: ["stage", "open"] }] } } };
  assert.equal(s.create(base, SYS).grant.parent, parent.id, "inside on every dimension");
  assert.throws(() => s.create({ ...base, level: "manage" }, SYS), err("not_contained"));
  assert.throws(() => s.create({ ...base, resource: { type: "project", id: "prj_other" } }, SYS), err("not_contained"));
  assert.throws(() => s.create({ ...base, expires_at: T + 2000 }, SYS), err("not_contained"));
  const { expires_at: _x, ...noExpiry } = base;
  assert.throws(() => s.create(noExpiry, SYS), err("not_contained"), "an expiring parent cannot have an immortal child");
  assert.throws(() => s.create({ ...base, conditions: { ...base.conditions, hiddenFields: ["fee"] } }, SYS), err("not_contained"), "the child hides at least what the parent hides");
  assert.throws(() => s.create({ ...base, conditions: { hiddenFields: ["ssn"] } }, SYS), err("not_contained"), "the child filters at least what the parent filters");
  assert.throws(() => s.create({ ...base, parent: "gr_nope" }, SYS), err("not_found"));
});

test("depth: a grant passes on at most three steps", () => {
  const s = mk();
  let g = s.create({ subject: sub("u0"), resource: prj, level: "manage", source: "direct" }, SYS).grant;
  for (let i = 1; i <= 3; i++) g = s.create({ subject: sub(`u${i}`), resource: prj, level: "manage", source: "delegate", parent: g.id }, SYS).grant;
  assert.throws(() => s.create({ subject: sub("u4"), resource: prj, level: "manage", source: "delegate", parent: g.id }, SYS), err("not_contained"));
});

test("revoke cascades to everything delegated, parent first; expiry and parent state show in effective()", () => {
  const s = mk();
  const root = s.create({ subject: sub("usr_dana"), resource: prj, level: "manage", source: "direct" }, SYS).grant;
  const kid = s.create({ subject: sub("usr_sam"), resource: prj, level: "edit", source: "delegate", parent: root.id }, SYS).grant;
  const timed = s.create({ subject: sub("usr_pat"), resource: prj, level: "view", source: "link", expires_at: T + 10 }, SYS).grant;
  assert.equal(s.effective(timed), "active");
  T += 10;
  assert.equal(s.effective(timed), "expired");
  assert.deepEqual(s.forSubject(sub("usr_pat")), []);
  const evs = s.revoke(root.id, "usr_owner", "left the firm");
  assert.deepEqual(evs.map((e) => e.type === "grant.revoked" && e.id), [root.id, kid.id]);
  assert.equal(s.get(kid.id)!.reason, "parent revoked");
  assert.equal(s.effective(s.get(kid.id)!), "revoked");
  assert.deepEqual(s.revoke(root.id, "usr_owner"), [], "revoking twice does nothing");
  assert.equal(s.levelFor(sub("usr_dana"), prj), null);
  assert.throws(() => s.create({ subject: sub("usr_x"), resource: prj, level: "view", source: "delegate", parent: root.id }, SYS), err("revoked"));
});

test("narrow: only smaller", () => {
  const s = mk();
  const g = s.create({ subject: sub("usr_dana"), resource: prj, level: "edit", source: "direct" }, SYS).grant;
  assert.equal(s.narrow(g.id, { level: "view" }).grant.level, "view");
  assert.throws(() => s.narrow(g.id, { level: "manage" }), err("not_contained"));
  assert.throws(() => s.narrow(g.id, { resource: { type: "project", id: "prj_other" } }), err("not_contained"));
  assert.equal(s.narrow(g.id, { conditions: { hiddenFields: ["fee"] } }).grant.conditions.hiddenFields?.[0], "fee");
  assert.throws(() => s.narrow(g.id, { conditions: { hiddenFields: [] } }), err("not_contained"), "un-hiding is widening");
});

test("roles: the table, who may set whom, and a membership as role-sourced grants", () => {
  assert.deepEqual([ROLE_RANK.owner, ROLE_RANK.temp], [4, 0]);
  assert.equal(maySet("owner", "admin"), true);
  assert.equal(maySet("admin", "admin"), false);
  assert.equal(maySet("admin", "temp"), true);
  assert.equal(maySet("member", "temp"), false);
  assert.deepEqual(ROLE_MAY_SET.manager, []);
  assert.ok(ROLE_PERMS.owner.includes("space.upgrade") && !ROLE_PERMS.admin.includes("space.upgrade"));
  assert.ok(ROLE_PERMS.temp.every((p) => ROLE_PERMS.member.includes(p)), "temp is inside member");
  assert.ok(ROLE_PERMS.member.every((p) => ROLE_PERMS.manager.includes(p)) && ROLE_PERMS.manager.every((p) => ROLE_PERMS.admin.includes(p)));
  const s = mk();
  const evs = s.membership("usr_dana", "member", [prj], SYS, { by_role: "admin" });
  assert.equal(evs.length, 1);
  assert.deepEqual([s.list({ source: "role:member" }).length, s.levelFor(sub("usr_dana"), rec)], [1, ROLE_LEVEL.member]);
  const again = s.membership("usr_dana", "manager", [prj], SYS, { by_role: "owner" });
  assert.deepEqual(again.map((e) => e.type), ["grant.revoked", "grant.created"], "a changed role revokes the old role grants first");
  assert.throws(() => s.membership("usr_dana", "admin", [prj], SYS, { by_role: "admin" }), err("role_lacks_permission"));
  assert.throws(() => s.membership("usr_pat", "temp", [prj], SYS, { by_role: "admin" }), err("bad_input"), "temp needs an expiry");
  assert.equal(s.membership("usr_pat", "temp", [prj], SYS, { by_role: "admin", expires_at: T + 99 }).length, 1);
});

test("events fold back into an identical store (replica / rebuild)", () => {
  const a = mk(), log: GrantEvent[] = [];
  const g = a.create({ subject: sub("usr_dana"), resource: prj, level: "manage", source: "direct" }, SYS);
  log.push(g.event);
  const k = a.create({ subject: sub("usr_sam"), resource: prj, level: "edit", source: "delegate", parent: g.grant.id }, SYS);
  log.push(k.event, a.narrow(k.grant.id, { level: "view" }).event, ...a.revoke(g.grant.id, "usr_owner"));
  const b = mk();
  for (const e of log) b.apply(e);
  assert.deepEqual(b.list().map((x) => [x.id, x.status, x.level]), a.list().map((x) => [x.id, x.status, x.level]));
});
