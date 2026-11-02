// An owner's assistant acts with its owner's access to the owner's mailbox, up to Use ("summarize my inbox"), and with nobody else's. Manage stays with the person, and other kinds of
// resource are untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../src/authorize/index.ts";
import { buildWorld, NOW, AGENT } from "../src/authorize/fixture.ts";

const act = (level: "view" | "use" | "manage") => ({ perm: null, level }) as const;

test("the assistant of a mailbox's owner may view and use it, never manage it; another person's assistant may do none of it", () => {
  let worlds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { snap } = buildWorld(seed);
    if (snap.info("p1")?.p.status !== "active" || snap.info("p2")?.p.status !== "active" || snap.info(AGENT)?.p.status !== "active") continue;
    worlds++;
    snap.putResource({ id: "mbx_p1", type: "mailbox", parent_id: "root", label: 0, owner_id: "p1", holds: 0 });
    snap.putResource({ id: "mbx_p2", type: "mailbox", parent_id: "root", label: 0, owner_id: "p2", holds: 0 });
    snap.putResource({ id: "rec_p1", type: "deal", parent_id: "root", label: 0, owner_id: "p1", holds: 0 });
    const mine = (level: "view" | "use" | "manage", on = "mbx_p1", acting = "p1") => authorize(snap, { principal: AGENT, actingFor: acting, action: act(level), resource: { type: "mailbox", id: on }, now: NOW });
    // the person themselves own it; their assistant gets what they could get, up to Use
    assert.equal(authorize(snap, { principal: "p1", action: act("view"), resource: { type: "mailbox", id: "mbx_p1" }, now: NOW }).effect, "allow");
    assert.equal(mine("view").effect, "allow", `seed ${seed}: view`);
    assert.equal(mine("use").effect, "allow", `seed ${seed}: use`);
    assert.equal(mine("view").scope!.level, "use", "capped at Use");
    assert.equal(mine("manage").effect, "deny", `seed ${seed}: manage stays with the person`);
    // never wider than the person asking
    assert.equal(mine("view", "mbx_p2", "p1").effect, "deny", `seed ${seed}: p1's assistant reads p2's mailbox`);
    assert.equal(mine("view", "mbx_p1", "p2").effect, "deny", `seed ${seed}: p2's assistant reads p1's mailbox`);
    // only mailboxes
    assert.equal(authorize(snap, { principal: AGENT, actingFor: "p1", action: act("view"), resource: { type: "deal", id: "rec_p1" }, now: NOW }).effect === "allow" && authorize(snap, { principal: "p1", action: act("view"), resource: { type: "deal", id: "rec_p1" }, now: NOW }).effect === "deny", false, "the rule does not reach other kinds");
  }
  assert.ok(worlds >= 20, `worlds exercised: ${worlds}`);
});

test("an agent sends from a mailbox or number its person may use, with no grant of its own; never above the person, never Manage", () => {
  let worlds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { snap } = buildWorld(seed);
    if (snap.info("p1")?.p.status !== "active" || snap.info("p2")?.p.status !== "active" || snap.info(AGENT)?.p.status !== "active") continue;
    worlds++;
    for (const [id, type] of [["mbx_team", "mailbox"], ["num_team", "number"]] as const) {
      snap.putResource({ id, type, parent_id: null, label: 0, owner_id: "p2", holds: 0 });
      const as = (acting: string, level: "use" | "manage") => authorize(snap, { principal: AGENT, actingFor: acting, action: act(level), resource: { type, id }, now: NOW }).effect;
      assert.equal(as("p2", "use"), "allow", `seed ${seed}: the owner's agent uses the ${type}`);
      assert.equal(as("p2", "manage"), "deny", `seed ${seed}: Manage stays with the person`);
      assert.equal(as("p1", "use"), authorize(snap, { principal: "p1", action: act("use"), resource: { type, id }, now: NOW }).effect, `seed ${seed}: the person is the ceiling`);
      assert.equal(authorize(snap, { principal: AGENT, action: act("use"), resource: { type, id }, now: NOW }).effect, "deny", `seed ${seed}: an agent alone has no person's ceiling`);
    }
  }
  assert.ok(worlds >= 20, `worlds exercised: ${worlds}`);
});

test("a Mine Vault folder is its person's alone: their own agent uses it for them, another person's agent is refused, a Space-wide agent grant passes nothing into it", () => {
  let worlds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { snap } = buildWorld(seed);
    if (snap.info("p1")?.p.status !== "active" || snap.info(AGENT)?.p.status !== "active") continue;
    worlds++;
    snap.putResource({ id: "vfd_mine_p1", type: "vault_folder", parent_id: null, label: 0, owner_id: "p1", holds: 0 });
    snap.putResource({ id: "vit_key_p1", type: "vault_item", parent_id: "vfd_mine_p1", label: 0, owner_id: "p1", holds: 0 });
    snap.putGrant({ id: "gr_agent_root", subject_kind: "actor", subject_id: AGENT, resource_type: "folder", resource_id: "root", level: "edit", conditions: {}, expires_at: null } as never);
    const as = (acting: string, level: "use" | "edit") => authorize(snap, { principal: AGENT, actingFor: acting, action: act(level), resource: { type: "vault_item", id: "vit_key_p1" }, now: NOW }).effect;
    assert.equal(as("p1", "use"), "allow", `seed ${seed}: its own person's agent uses the key for them`);
    assert.equal(as("p1", "edit"), "deny", `seed ${seed}: up to Use only`);
    assert.equal(as("p2", "use"), "deny", `seed ${seed}: another person's agent is refused a Mine item`);
    assert.equal(as("p3", "use"), "deny", `seed ${seed}: so is any other`);
  }
  assert.ok(worlds >= 20, `worlds exercised: ${worlds}`);
});

test("an agent builds definitions its person may build, never more", () => {
  let worlds = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { snap } = buildWorld(seed);
    if (snap.info("p1")?.p.status !== "active" || snap.info("p2")?.p.status !== "active" || snap.info(AGENT)?.p.status !== "active") continue;
    worlds++;
    snap.putRole({ id: "builder", clearance: 3, perms: ["journeys.manage", "schema.manage"], name: "Builder" });
    snap.addPrincipalRole({ holder: "p1", role: "builder" });
    const build = (acting: string) => authorize(snap, { principal: AGENT, actingFor: acting, action: { perm: "journeys.manage", level: "view" }, resource: { type: "folder", id: "root" }, now: NOW }).effect;
    const person = (who: string) => authorize(snap, { principal: who, action: { perm: "journeys.manage", level: "view" }, resource: { type: "folder", id: "root" }, now: NOW }).effect;
    if (person("p1") === "allow" && authorize(snap, { principal: AGENT, actingFor: "p1", action: act("view"), resource: { type: "folder", id: "root" }, now: NOW }).effect === "allow") assert.equal(build("p1"), "allow", `seed ${seed}: the person's role is the ceiling`);
    if (person("p2") === "deny") assert.equal(build("p2"), "deny", `seed ${seed}: never above the person`);
    assert.equal(authorize(snap, { principal: AGENT, actingFor: "p1", action: { perm: "access.manage", level: "view" }, resource: { type: "folder", id: "root" }, now: NOW }).effect, "deny", `seed ${seed}: only definitions, never access.manage`);
  }
  assert.ok(worlds >= 20, `worlds exercised: ${worlds}`);
});
