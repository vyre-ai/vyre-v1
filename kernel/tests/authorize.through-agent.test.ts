// A key approved for an agent's request (owner ruling, 3 Nov 2026): the approver chooses who may use it through that agent. "Only the person who asked" (the default) lets the agent use
// it for that person, who has no access of their own; "Anyone who asks this agent" lets it for anyone. Never above Use, never another resource, and a plain grant still intersects.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../src/authorize/index.ts";
import { buildWorld, NOW, AGENT } from "../src/authorize/fixture.ts";
import { THROUGH_AGENT, THROUGH_ANYONE } from "../../lib/through-agent.ts";

const act = (level: "view" | "use" | "edit") => ({ perm: null, level }) as const;

test("through the agent: the asker, or anyone, may use the approved key with no access of their own; never above Use, and a plain agent grant still needs the person", () => {
  let worlds = 0, checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { snap } = buildWorld(seed);
    if (snap.info("p1")?.p.status !== "active" || snap.info("p2")?.p.status !== "active" || snap.info(AGENT)?.p.status !== "active") continue;
    worlds++;
    snap.putResource({ id: "vfd_shared", type: "vault_folder", parent_id: null, label: 0, owner_id: "p3", holds: 0 });
    for (const id of ["vit_plain", "vit_asker", "vit_anyone"]) snap.putResource({ id, type: "vault_item", parent_id: "vfd_shared", label: 0, owner_id: "p3", holds: 0 });
    const grant = (id: string, item: string, source?: string) => snap.putGrant({ id, subject_kind: "actor", subject_id: AGENT, resource_type: "vault_item", resource_id: item, level: "use", ...(source ? { source } : {}) });
    grant("g_plain", "vit_plain");
    grant("g_asker", "vit_asker"); grant("g_asker_t", "vit_asker", `${THROUGH_AGENT}p1`);
    grant("g_any", "vit_anyone"); grant("g_any_t", "vit_anyone", `${THROUGH_AGENT}${THROUGH_ANYONE}`);
    const as = (item: string, acting: string, level: "view" | "use" | "edit" = "use") => authorize(snap, { principal: AGENT, actingFor: acting, action: act(level), resource: { type: "vault_item", id: item }, now: NOW }).effect;
    const own = (item: string, person: string) => authorize(snap, { principal: person, action: act("use"), resource: { type: "vault_item", id: item }, now: NOW }).effect;
    // the persons here hold nothing on these items of their own unless their role reaches every vault item; only then is the old rule enough
    if (own("vit_plain", "p2") === "allow" || own("vit_plain", "p1") === "allow") continue;
    checked++;
    assert.equal(as("vit_plain", "p1"), "deny", `seed ${seed}: an agent grant alone still needs the person (today's rule)`);
    assert.equal(as("vit_asker", "p1"), "allow", `seed ${seed}: the person who asked uses it through the agent`);
    assert.equal(as("vit_asker", "p2"), "deny", `seed ${seed}: someone else does not`);
    assert.equal(as("vit_anyone", "p2"), "allow", `seed ${seed}: anyone who asks this agent`);
    assert.equal(as("vit_anyone", "p1"), "allow");
    assert.equal(as("vit_asker", "p1", "edit"), "deny", `seed ${seed}: never above Use`);
    assert.equal(own("vit_asker", "p1"), "deny", `seed ${seed}: the person gets nothing outside the agent`);
    assert.equal(authorize(snap, { principal: AGENT, action: act("use"), resource: { type: "vault_item", id: "vit_anyone" }, now: NOW }).effect, "deny", `seed ${seed}: the agent alone still acts for nobody`);
  }
  assert.ok(worlds >= 5 && checked >= 3, `worlds exercised: ${worlds}, checked: ${checked}`);
});
