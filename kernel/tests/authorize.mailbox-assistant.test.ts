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
