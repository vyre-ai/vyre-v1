// The permission matrix (spec 2.3, 4.12, 2.2; ARCH 10.3, 4.5): every built-in role against every permission of the catalogue on every resource type that permission names, read from the generated
// catalogue (not from the module's own parser), so a change to a role, a permission or the checker that is not in the catalogue fails here by name. Beside it: the grant level a person holds
// against the level asked for, the label a role is cleared for, ownership, suspension and holds, the Access checker and View as, and the rule that an agent never holds Owner or Admin
// (assigned directly, held through a group, or acting for an owner) and never goes past the person it acts for.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../../../../kernel/src/authorize/index.ts";
import type { Level, Req } from "../../../../kernel/src/authorize/index.ts";
import { permissions } from "../../../../generated/permissions.ts";
import { harness } from "../../fixtures/db.ts";
import { check, viewAs } from "../../handlers/check.ts";
import { putPrincipal, rolesAssign, rolesCreate, rolesUpdate } from "../../handlers/roles.ts";
import { LABEL_OF, labelRank, storeOf } from "../../projections.ts";
import type { AccessStore, Label } from "../../projections.ts";

const NOW = 1_700_000_000_000;
const ROLES = ["owner", "admin", "developer", "member", "guest"] as const;
type Role = (typeof ROLES)[number];
const LEVELS: readonly Level[] = ["view", "use", "edit", "manage"];
const CLEARANCE: Record<Role, Label> = { owner: "restricted", admin: "restricted", developer: "confidential", member: "internal", guest: "public" };

interface Perm { key: string; defaults: Record<string, boolean>; appliesTo: readonly string[] }
const CATALOGUE = permissions as unknown as readonly Perm[];
const holds = (role: Role, key: string): boolean => CATALOGUE.find((p) => p.key === key)?.defaults[role] === true;
const typesOf = (p: Perm): string[] => [...new Set(["record", ...p.appliesTo])];
const ALL_TYPES: readonly string[] = [...new Set(CATALOGUE.flatMap((p) => ["record", ...p.appliesTo]))].sort();

const decide = (store: AccessStore, principal: string, perm: string | null, type: string, id: string, level: Level = "view", extra: Partial<Req> = {}) =>
  authorize(store.snapshot(), { principal, action: { perm, level, destructive: false }, resource: { type, id }, now: NOW, explain: true, ...extra });

/** Three people per role: one with a Manage grant on every type, one with the role and no grant, one who owns a record of each type. */
function world() {
  const h = harness();
  const store = storeOf(h.ctx);
  for (const role of ROLES) {
    for (const prefix of ["g", "n", "o"]) {
      const id = `${prefix}_${role}`;
      putPrincipal(store, { id, kind: "person", name: id });
      store.setRoles(id, [`rol_${role}`]);
    }
  }
  for (const type of ALL_TYPES) {
    store.resources.set(`res_${type}`, { id: `res_${type}`, type, parentId: null, label: "public", ownerId: null, holds: 0 });
    for (const role of ROLES) store.resources.set(`own_${role}_${type}`, { id: `own_${role}_${type}`, type, parentId: null, label: "public", ownerId: `o_${role}`, holds: 0 });
    for (const role of ROLES) {
      const id = `gnt_${role}_${type}`;
      store.grants.set(id, { id, subject: { kind: "person", id: `g_${role}` }, resource: { type, id: "*" }, level: "manage", conditions: {}, by: "usr_admin", createdAt: NOW });
    }
  }
  store.bump();
  return { h, store };
}

test("the catalogue has the permissions the matrix runs over, and the built-in roles are seeded from it", () => {
  const { store } = world();
  assert.ok(CATALOGUE.length >= 50, `catalogue has ${CATALOGUE.length} permissions`);
  assert.equal(new Set(CATALOGUE.map((p) => p.key)).size, CATALOGUE.length, "no permission is listed twice");
  for (const p of CATALOGUE) {
    assert.deepEqual(Object.keys(p.defaults).sort(), [...ROLES].sort(), `${p.key} has a default for every built-in role`);
    assert.equal(p.defaults["owner"], true, `${p.key}: Owner holds every permission`);
    assert.equal(p.defaults["guest"], false, `${p.key}: Guest holds none`);
  }
  for (const role of ROLES) {
    const want = CATALOGUE.filter((p) => p.defaults[role] === true).map((p) => p.key).sort();
    const got = [...store.roles.get(`rol_${role}`)!.permissions].sort();
    assert.deepEqual(got, want, `${role}: the seeded role is the catalogue column`);
    assert.equal(store.roles.get(`rol_${role}`)!.clearance, CLEARANCE[role], `${role}: clearance`);
  }
  assert.ok(CATALOGUE.some((p) => p.defaults["admin"] && !p.defaults["developer"]), "some permission is Admin-only, so the matrix tells Admin from Developer");
  assert.ok(CATALOGUE.some((p) => p.defaults["developer"] && !p.defaults["member"]), "some permission is Developer-up, so the matrix tells Developer from Member");
});

test("matrix: every built-in role x every permission x the types it applies to: allowed exactly when the catalogue gives the role the permission", () => {
  const { store } = world();
  let checks = 0;
  const wrong: string[] = [];
  for (const role of ROLES) {
    for (const p of CATALOGUE) {
      const want = holds(role, p.key);
      for (const type of typesOf(p)) {
        // a person with the role and a Manage grant on the type
        const withGrant = decide(store, `g_${role}`, p.key, type, `res_${type}`);
        if ((withGrant.effect === "allow") !== want) wrong.push(`${role} ${p.key} on ${type} with a grant: ${withGrant.effect} (${withGrant.reason})`);
        if (!want && withGrant.reason !== "role_lacks_permission") wrong.push(`${role} ${p.key} on ${type}: denied for ${withGrant.reason}, not for the role`);
        // the role with no grant: the permission alone opens nothing
        const bare = decide(store, `n_${role}`, p.key, type, `res_${type}`);
        if (bare.effect !== "deny") wrong.push(`${role} ${p.key} on ${type} with no grant: ${bare.effect}`);
        const bareWhy = want ? "no_grant" : "role_lacks_permission";
        if (bare.reason !== bareWhy) wrong.push(`${role} ${p.key} on ${type} with no grant: ${bare.reason}, wanted ${bareWhy}`);
        // owning the resource stands in for a grant, never for the role's permission
        const owner = decide(store, `o_${role}`, p.key, type, `own_${role}_${type}`);
        if ((owner.effect === "allow") !== want) wrong.push(`${role} ${p.key} on ${type} as its owner: ${owner.effect} (${owner.reason})`);
        checks += 3;
      }
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} cells of ${checks} are wrong`);
  assert.ok(checks >= 1000, `the matrix ran ${checks} checks`);
});

test("matrix: Guest is denied every permission on every type, and Owner is allowed every permission on every type", () => {
  const { store } = world();
  for (const p of CATALOGUE) for (const type of typesOf(p)) {
    assert.equal(decide(store, "g_guest", p.key, type, `res_${type}`, "manage").reason, "role_lacks_permission", `guest ${p.key} ${type}`);
    assert.equal(decide(store, "g_owner", p.key, type, `res_${type}`, "manage").effect, "allow", `owner ${p.key} ${type}`);
  }
});

test("matrix: a read that names no permission rests on the grant alone, for every role including Guest", () => {
  const { store } = world();
  // an action with no permission (a plain read) rests on the grant alone, for every role including Guest
  for (const role of ROLES) {
    for (const type of ALL_TYPES) {
      assert.equal(decide(store, `g_${role}`, null, type, `res_${type}`).effect, "allow", `${role} reads ${type} with a grant`);
      assert.equal(decide(store, `n_${role}`, null, type, `res_${type}`).reason, "no_grant", `${role} reads ${type} without one`);
    }
  }
});

test("matrix: the level a grant gives against the level asked for, for every pair", () => {
  const { store } = world();
  for (const have of LEVELS) {
    const who = `lv_${have}`;
    putPrincipal(store, { id: who, kind: "person", name: who });
    store.setRoles(who, ["rol_member"]);
    store.grants.set(`gnt_${who}`, { id: `gnt_${who}`, subject: { kind: "person", id: who }, resource: { type: "record", id: "*" }, level: have, conditions: {}, by: "usr_admin", createdAt: NOW });
  }
  store.bump();
  for (const have of LEVELS) for (const need of LEVELS) {
    const d = decide(store, `lv_${have}`, "records.edit", "record", "res_record", need);
    assert.equal(d.effect === "allow", LEVELS.indexOf(have) >= LEVELS.indexOf(need), `holding ${have}, asking ${need}: ${d.effect}`);
    if (d.effect === "deny") assert.equal(d.reason, "no_grant");
  }
});

test("matrix: every role against every label: allowed only up to the label the role is cleared for", () => {
  const { store } = world();
  for (const label of LABEL_OF) {
    store.resources.set(`lbl_${label}`, { id: `lbl_${label}`, type: "record", parentId: null, label, ownerId: null, holds: 0 });
  }
  store.bump();
  for (const role of ROLES) for (const label of LABEL_OF) {
    const d = decide(store, `g_${role}`, role === "guest" ? null : "records.edit", "record", `lbl_${label}`);
    const cleared = labelRank(label) <= labelRank(CLEARANCE[role]);
    assert.equal(d.effect === "allow", cleared, `${role} on ${label}: ${d.effect} (${d.reason})`);
    if (!cleared) assert.equal(d.reason, "above_clearance");
  }
});

test("matrix: a suspended or removed person, an unknown id, and an item on hold", () => {
  const { store } = world();
  for (const status of ["suspended", "removed"] as const) {
    putPrincipal(store, { id: `s_${status}`, kind: "person", name: status, status });
    store.setRoles(`s_${status}`, ["rol_owner"]);
    store.grants.set(`gnt_s_${status}`, { id: `gnt_s_${status}`, subject: { kind: "person", id: `s_${status}` }, resource: { type: "record", id: "*" }, level: "manage", conditions: {}, by: "usr_admin", createdAt: NOW });
  }
  store.bump();
  assert.equal(decide(store, "s_suspended", "records.edit", "record", "res_record").reason, "suspended");
  assert.equal(decide(store, "s_removed", "records.edit", "record", "res_record").reason, "suspended");
  assert.equal(decide(store, "nobody", "records.edit", "record", "res_record").reason, "not_a_member");
  store.resources.set("held", { id: "held", type: "record", parentId: null, label: "public", ownerId: "o_owner", holds: 1 });
  store.bump();
  const del = (who: string) => authorize(store.snapshot(), { principal: who, action: { perm: "records.delete", level: "manage", destructive: true }, resource: { type: "record", id: "held" }, now: NOW });
  assert.equal(del("g_owner").reason, "on_hold", "a hold stops a destructive act, even for Owner");
  assert.equal(del("o_owner").reason, "on_hold", "and for the item's own owner");
  assert.equal(decide(store, "g_owner", "records.edit", "record", "held").effect, "allow", "a hold does not stop an edit");
});

test("the Access checker and View as: the checker answers what authorize answers, in plain words; View as starts a preview for a person who exists", async () => {
  const { h, store } = world();
  const checker = async (person: string, perm: string, type: string, level: Level = "view") =>
    (await check(h.ctx, { principal: { kind: "person", id: person }, action: { perm, level }, resource: { type, id: `res_${type}` } })).decision;
  for (const role of ROLES) {
    for (const p of CATALOGUE.slice(0, 20)) {
      const type = typesOf(p)[0]!;
      const seen = await checker(`g_${role}`, p.key, type);
      const direct = decide(store, `g_${role}`, p.key, type, `res_${type}`);
      assert.equal(seen.effect, direct.effect, `${role} ${p.key}`);
      assert.equal(seen.reason, direct.reason);
      assert.ok(seen.steps.length > 0 && seen.steps.every((s) => typeof s.text === "string" && s.text.length > 0), "the checker explains in words");
      assert.ok(seen.decisionId.length > 0);
    }
  }
  const allowed = await checker("g_member", "records.edit", "record");
  assert.ok(allowed.steps.some((s) => /role Member allows records\.edit/.test(s.text)), "names the role that allows it");
  assert.ok(allowed.steps.some((s) => /grant gnt_member_record \(manage\)/.test(s.text)), "names the grant");
  const denied = await checker("g_member", "records.delete", "record");
  assert.equal(denied.effect, "deny");
  assert.ok(denied.steps.at(-1)!.ok === false && /has no role that allows this/.test(denied.steps.at(-1)!.text), "says why in plain words");
  const none = await checker("n_member", "records.edit", "record");
  assert.match(none.steps.at(-1)!.text, /has no grant on this and does not own it/);

  for (const role of ROLES) {
    h.events.length = 0;
    const v = await viewAs(h.ctx, { person: `g_${role}` });
    assert.match(v.previewToken, /^vas_[0-9a-f]+$/);
    assert.ok(v.expiresAt > NOW && v.expiresAt <= NOW + 10 * 60 * 1000, "a preview lasts minutes");
    assert.deepEqual(h.events, [{ name: "view_as.started", subject: `g_${role}`, payload: { target: `g_${role}`, expiresAt: v.expiresAt } }]);
  }
  await assert.rejects(viewAs(h.ctx, { person: "nobody" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "validation.not_found");
});

test("built-in roles are locked to editing but can be cloned, and a clone starts as an exact copy", async () => {
  const { h, store } = world();
  for (const role of ROLES) {
    await assert.rejects(rolesUpdate(h.ctx, { roleId: `rol_${role}`, name: "Renamed" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "validation.field_locked", `${role} is locked`);
    const { role: copy } = await rolesCreate(h.ctx, { name: `${role} copy`, cloneFrom: `rol_${role}`, idempotencyKey: `clone_${role}` });
    assert.deepEqual([...copy.permissions].sort(), [...store.roles.get(`rol_${role}`)!.permissions].sort(), `${role} copy has the same permissions`);
    assert.equal(copy.builtIn, false);
    assert.equal(copy.clearance, CLEARANCE[role]);
    assert.equal(copy.assignableToAgents, store.roles.get(`rol_${role}`)!.assignableToAgents);
  }
});

/* ---------- agents ---------- */

const code = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as { error?: { code?: string } }).error?.code ?? "no code"; } return "no error"; };

test("an agent is never given Owner or Admin: not when assigned, not through a role cloned from them", async () => {
  const { h, store } = world();
  putPrincipal(store, { id: "agt_x", kind: "agent", name: "Agent", owner: "g_member" });
  assert.equal(await code(rolesAssign(h.ctx, { subject: { kind: "agent", id: "agt_x" }, roleId: "rol_owner" })), "validation.precondition_failed");
  assert.equal(await code(rolesAssign(h.ctx, { subject: { kind: "agent", id: "agt_x" }, roleId: "rol_admin" })), "validation.precondition_failed");
  const boss = (await rolesCreate(h.ctx, { name: "Boss", cloneFrom: "rol_owner", idempotencyKey: "boss" })).role;
  assert.equal(boss.assignableToAgents, false, "a clone of Owner is no more assignable than Owner");
  assert.equal(await code(rolesAssign(h.ctx, { subject: { kind: "agent", id: "agt_x" }, roleId: boss.id })), "validation.precondition_failed");
  for (const ok of ["rol_developer", "rol_member", "rol_guest"]) assert.equal(await code(rolesAssign(h.ctx, { subject: { kind: "agent", id: "agt_x" }, roleId: ok })), "no error", ok);
  assert.deepEqual(store.rolesOf("agt_x").sort(), ["rol_developer", "rol_guest", "rol_member"]);
  assert.equal(await code(rolesAssign(h.ctx, { subject: { kind: "person", id: "g_member" }, roleId: "rol_owner" })), "validation.precondition_failed", "ownership uses the transfer path even for people");
  assert.equal(await code(rolesAssign(h.ctx, { subject: { kind: "person", id: "g_member" }, roleId: "rol_admin" })), "no error", "a person can hold Admin");
  const roleOf = (id: string) => store.roles.get(id)!;
  assert.deepEqual([roleOf("rol_owner").assignableToAgents, roleOf("rol_admin").assignableToAgents], [false, false]);
});

test("an agent that somehow holds Owner or Admin in the projection is still stripped of them when it is checked", () => {
  const { store } = world();
  putPrincipal(store, { id: "agt_forced", kind: "agent", name: "Forced", owner: "g_owner" });
  store.setRoles("agt_forced", ["rol_owner", "rol_admin"]);
  store.grants.set("gnt_forced", { id: "gnt_forced", subject: { kind: "agent", id: "agt_forced" }, resource: { type: "record", id: "*" }, level: "manage", conditions: {}, by: "usr_admin", createdAt: NOW });
  store.bump();
  for (const p of CATALOGUE) {
    const d = decide(store, "agt_forced", p.key, "record", "res_record", "view", { actingFor: "g_owner" });
    assert.equal(d.effect, "deny", `${p.key}: an agent whose only roles are Owner and Admin holds nothing`);
    assert.equal(d.reason, "role_lacks_permission");
  }
  // with a real role beside them it holds exactly that role's permissions, and Admin-only ones stay out
  store.setRoles("agt_forced", ["rol_owner", "rol_admin", "rol_member"]);
  store.bump();
  for (const p of CATALOGUE) {
    const d = decide(store, "agt_forced", p.key, "record", "res_record", "view", { actingFor: "g_owner" });
    assert.equal(d.effect === "allow", holds("member", p.key), `${p.key}: only what Member holds`);
  }
});

// Fixed by P-SEC_01: the kernel strips by role id and name (rol_owner, rol_admin), for direct, group and nested-group roles. This is the rule (ARCH 4.5 "Agents never hold owner or admin") as a plain test.
test("an agent is not elevated by a group that holds Owner or Admin", () => {
  const { store } = world();
  putPrincipal(store, { id: "agt_grp", kind: "agent", name: "Grouped", owner: "g_owner" });
  store.setRoles("agt_grp", ["rol_member"]);
  store.groups.set("grp_boss", { id: "grp_boss", name: "Bosses", builtIn: false, members: [{ kind: "agent", id: "agt_grp" }, { kind: "person", id: "g_owner" }], managers: [] });
  store.setRoles("grp_boss", ["rol_owner"]);
  store.grants.set("gnt_grp", { id: "gnt_grp", subject: { kind: "agent", id: "agt_grp" }, resource: { type: "record", id: "*" }, level: "manage", conditions: {}, by: "usr_admin", createdAt: NOW });
  store.bump();
  const adminOnly = CATALOGUE.filter((p) => p.defaults["admin"] && !p.defaults["member"]).map((p) => p.key);
  assert.ok(adminOnly.length > 5);
  for (const key of adminOnly) {
    const d = decide(store, "agt_grp", key, "record", "res_record", "view", { actingFor: "g_owner" });
    assert.equal(d.effect, "deny", `${key}: the group's Owner role does not reach the agent`);
  }
});

test("an agent needs a person to act for, and never goes past that person or its own role", () => {
  const { store } = world();
  putPrincipal(store, { id: "agt_dev", kind: "agent", name: "Dev agent", owner: "g_member" });
  store.setRoles("agt_dev", ["rol_developer"]);
  store.grants.set("gnt_dev", { id: "gnt_dev", subject: { kind: "agent", id: "agt_dev" }, resource: { type: "record", id: "*" }, level: "manage", conditions: {}, by: "usr_admin", createdAt: NOW });
  store.bump();
  assert.equal(decide(store, "agt_dev", "records.edit", "record", "res_record").reason, "agent_needs_actor");
  assert.equal(decide(store, "agt_dev", "records.edit", "record", "res_record", "view", { actingFor: "agt_dev" }).reason, "agent_needs_actor", "an agent cannot act for itself");
  assert.equal(decide(store, "agt_dev", "records.edit", "record", "res_record", "view", { actingFor: "unknown_person" }).reason, "agent_needs_actor");
  // the intersection: the agent and the person must both allow
  for (const p of CATALOGUE) {
    for (const forRole of ROLES) {
      const d = decide(store, "agt_dev", p.key, "record", "res_record", "view", { actingFor: `g_${forRole}` });
      const both = holds("developer", p.key) && holds(forRole, p.key);
      assert.equal(d.effect === "allow", both, `agent (Developer) for ${forRole}, ${p.key}: ${d.effect} (${d.reason})`);
    }
  }
  // an Admin-only act is out of reach even when the agent acts for the Owner
  assert.equal(decide(store, "agt_dev", "records.delete", "record", "res_record", "view", { actingFor: "g_owner" }).reason, "role_lacks_permission");
  // and a person's own grant does not lend the agent more than the agent's grant allows
  store.grants.delete("gnt_dev");
  store.bump();
  assert.equal(decide(store, "agt_dev", "records.edit", "record", "res_record", "view", { actingFor: "g_owner" }).reason, "no_grant");
});

test("a Service is capped by the person who owns it", () => {
  const { store } = world();
  putPrincipal(store, { id: "svc_x", kind: "service", name: "Service", owner: "g_member" });
  store.setRoles("svc_x", ["rol_admin"]);
  store.grants.set("gnt_svc", { id: "gnt_svc", subject: { kind: "service", id: "svc_x" }, resource: { type: "record", id: "*" }, level: "manage", conditions: {}, by: "usr_admin", createdAt: NOW });
  store.bump();
  for (const p of CATALOGUE) {
    const d = decide(store, "svc_x", p.key, "record", "res_record");
    assert.equal(d.effect === "allow", holds("admin", p.key) && holds("member", p.key), `${p.key}: the Service holds Admin, its owner only Member (${d.reason})`);
  }
});
