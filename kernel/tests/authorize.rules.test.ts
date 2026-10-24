// The rules of ARCH 4.5 and the 4.5.1 mapping, one at a time.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, viewAs, authorizeAsync, AccessSnapshot } from "../src/authorize/index.ts";
import type { Req } from "../src/authorize/index.ts";

function base() {
  const s = new AccessSnapshot();
  s.putRole({ id: "owner", clearance: 3, perms: ["records.read", "records.write", "access.view_as"], name: "Owner" });
  s.putRole({ id: "member", clearance: 1, perms: ["records.read", "records.write", "email.send"], name: "Member" });
  s.putRole({ id: "none", clearance: 1, perms: [], name: "None" });
  s.putPrincipal({ id: "dana", kind: "person", status: "active", name: "Dana" });
  s.putPrincipal({ id: "sam", kind: "person", status: "active", name: "Sam" });
  s.putPrincipal({ id: "boss", kind: "person", status: "active", name: "Boss" });
  s.addPrincipalRole({ holder: "dana", role: "member" }); s.addPrincipalRole({ holder: "sam", role: "member" }); s.addPrincipalRole({ holder: "boss", role: "owner" });
  s.putResource({ id: "root", type: "folder", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "fold", type: "folder", parent_id: "root", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "rec1", type: "deal", parent_id: "fold", label: 0, owner_id: "sam", holds: 0 });
  s.putResource({ id: "sec1", type: "deal", parent_id: "fold", label: 2, owner_id: "sam", holds: 0 });
  s.putResource({ id: "held", type: "deal", parent_id: "fold", label: 0, owner_id: "sam", holds: 1 });
  return s;
}
const req = (o: Partial<Req> & { principal: string }): Req => ({ action: { perm: "records.read", level: "view" }, resource: { type: "deal", id: "rec1" }, now: 100, ...o });
const grant = (s: AccessSnapshot, id: string, over: Record<string, unknown> = {}) =>
  s.putGrant({ id, subject_kind: "actor", subject_id: "dana", resource_type: "folder", resource_id: "fold", level: "edit", ...over } as never);

test("no grant and not the owner: deny no_grant, with a plain-words step", () => {
  const d = authorize(base(), req({ principal: "dana" }));
  assert.equal(d.effect, "deny"); assert.equal(d.reason, "no_grant");
  assert.match(d.steps.at(-1)!.text, /Dana has no grant/);
});

test("a grant on an ancestor flows down; level must be high enough", () => {
  const s = base(); grant(s, "g1", { level: "use" });
  assert.equal(authorize(s, req({ principal: "dana", action: { perm: "records.read", level: "use" } })).effect, "allow");
  const d = authorize(s, req({ principal: "dana", action: { perm: "records.read", level: "edit" } }));
  assert.equal(d.reason, "no_grant");
});

test("the owner of a resource holds Manage on it", () => {
  const d = authorize(base(), req({ principal: "sam", action: { perm: "records.write", level: "manage" } }));
  assert.equal(d.effect, "allow"); assert.equal(d.scope!.level, "manage"); assert.equal(d.reason, "ok");
});

test("role lacks the permission: deny even with a grant", () => {
  const s = base(); s.addPrincipalRole({ holder: "dana", role: "none" }); grant(s, "g1");
  s.putPrincipal({ id: "eve", kind: "person", status: "active", name: "Eve" }); s.addPrincipalRole({ holder: "eve", role: "none" });
  s.putGrant({ id: "g2", subject_kind: "actor", subject_id: "eve", resource_type: "folder", resource_id: "fold", level: "manage" });
  assert.equal(authorize(s, req({ principal: "eve" })).reason, "role_lacks_permission");
  assert.equal(authorize(s, req({ principal: "dana" })).effect, "allow");
});

test("expired grants say expired; a window outside now does not match", () => {
  const s = base(); grant(s, "g1", { expires_at: 50 });
  assert.equal(authorize(s, req({ principal: "dana" })).reason, "expired");
  const s2 = base(); grant(s2, "g1", { conditions: { notBefore: 500 } });
  assert.equal(authorize(s2, req({ principal: "dana" })).reason, "no_grant");
});

test("clearance: a Restricted record is denied to a Sensitive-cleared member even with a grant and as owner", () => {
  const s = base(); grant(s, "g1");
  assert.equal(authorize(s, req({ principal: "dana", resource: { type: "deal", id: "sec1" } })).reason, "above_clearance");
  assert.equal(authorize(s, req({ principal: "sam", resource: { type: "deal", id: "sec1" } })).reason, "no_grant");
  assert.equal(authorize(s, req({ principal: "boss", resource: { type: "deal", id: "sec1" } })).reason, "no_grant");
  s.putGrant({ id: "gb", subject_kind: "actor", subject_id: "boss", resource_type: "folder", resource_id: "fold", level: "view" });
  assert.equal(authorize(s, req({ principal: "boss", resource: { type: "deal", id: "sec1" } })).effect, "allow");
});

test("a field label raises the effective label", () => {
  const s = base(); grant(s, "g1"); s.setFieldLabel("deal", "ssn", 2);
  assert.equal(authorize(s, req({ principal: "dana" })).effect, "allow");
  assert.equal(authorize(s, req({ principal: "dana", fields: ["ssn"] })).reason, "above_clearance");
});

test("holds block destructive actions only", () => {
  const s = base(); grant(s, "g1", { level: "manage" });
  const r = (destructive: boolean) => req({ principal: "dana", resource: { type: "deal", id: "held" }, action: { perm: "records.write", level: "manage", destructive } });
  assert.equal(authorize(s, r(false)).effect, "allow");
  assert.equal(authorize(s, r(true)).reason, "on_hold");
});

test("suspended and unknown principals are denied", () => {
  const s = base(); s.putPrincipal({ id: "dana", kind: "person", status: "suspended", name: "Dana" }); grant(s, "g1");
  assert.equal(authorize(s, req({ principal: "dana" })).reason, "suspended");
  assert.equal(authorize(s, req({ principal: "ghost" })).reason, "not_a_member");
  assert.equal(authorize(s, req({ principal: "boss", resource: { type: "deal", id: "nope" } })).reason, "not_found");
});

test("row filter needs the row (fail closed); hidden fields drop the grant for that field", () => {
  const s = base(); grant(s, "g1", { conditions: { rowFilter: { op: "eq", field: "stage", value: "won" }, hiddenFields: ["salary"] } });
  assert.equal(authorize(s, req({ principal: "dana" })).reason, "no_grant");
  assert.equal(authorize(s, req({ principal: "dana", row: { stage: "lost" } })).reason, "no_grant");
  const ok = authorize(s, req({ principal: "dana", row: { stage: "won" } }));
  assert.equal(ok.effect, "allow"); assert.deepEqual(ok.scope!.hiddenFields, ["salary"]);
  assert.equal(authorize(s, req({ principal: "dana", row: { stage: "won" }, fields: ["salary"] })).reason, "no_grant");
});

test("create checks the container and the type-wide grant", () => {
  const s = base(); grant(s, "g1");
  assert.equal(authorize(s, req({ principal: "dana", resource: { type: "deal", id: null, parent: "fold" }, action: { perm: "records.write", level: "edit" } })).effect, "allow");
  assert.equal(authorize(s, req({ principal: "dana", resource: { type: "deal", id: null } })).reason, "bad_input");
  assert.equal(authorize(s, req({ principal: "dana", resource: { type: "deal", id: null, parent: "zzz" } })).reason, "not_found");
});

test("policies: provider label, spend limit, Gate hold with approval, humans skip the Gate", () => {
  const s = base(); grant(s, "g1");
  s.setPolicies([
    { key: "pl", kind: "provider_label", allow: { cloud: 0, local: 3 } },
    { key: "sp", kind: "spend", meter: "ai", limitMicros: 1000 },
    { key: "ga", kind: "gate", act: "email.send", approver: "role:owner", caps: ["email.send"] },
  ]);
  const r = (o: Partial<Req>) => req({ principal: "dana", resource: { type: "deal", id: "rec1" }, ...o });
  s.putResource({ id: "lab1", type: "deal", parent_id: "fold", label: 1, owner_id: null, holds: 0 });
  assert.equal(authorize(s, r({ resource: { type: "deal", id: "lab1" }, provider: "cloud" })).reason, "provider_label");
  assert.equal(authorize(s, r({ resource: { type: "deal", id: "lab1" }, provider: "local" })).effect, "allow");
  assert.equal(authorize(s, r({ spendMicros: { ai: 1000 } })).reason, "limit");
  const ok = authorize(s, r({ spendMicros: { ai: 10 } }));
  assert.deepEqual(ok.obligations, [{ type: "spend", meter: "ai" }]);
  // Dana is a person: her own send skips the Gate
  assert.equal(authorize(s, r({ cap: "email.send" })).effect, "allow");
  // an agent acting for Dana is held
  s.putPrincipal({ id: "bot", kind: "agent", owner: "dana", status: "active", name: "Bot" }); s.addPrincipalRole({ holder: "bot", role: "member" });
  s.putGrant({ id: "gbot", subject_kind: "actor", subject_id: "bot", resource_type: "folder", resource_id: "fold", level: "edit" });
  const held = authorize(s, r({ principal: "bot", actingFor: "dana", cap: "email.send" }));
  assert.equal(held.effect, "hold"); assert.equal(held.reason, "needs_approval");
  assert.deepEqual(held.obligations.find((o) => o.type === "gate"), { type: "gate", act: "email.send", approver: "role:owner", checker_must_be_person: true });
  assert.equal(authorize(s, r({ principal: "bot", actingFor: "dana", cap: "email.send", approved: true })).effect, "allow");
});

test("decisionId is minted on first read and then stable; explain builds the trace", () => {
  const s = base(); grant(s, "g1");
  const d = authorize(s, req({ principal: "dana", explain: true }));
  assert.match(d.decisionId, /^dec_[0-9a-f-]{36}$/); assert.equal(d.decisionId, d.decisionId);
  assert.notEqual(authorize(s, req({ principal: "dana" })).decisionId, d.decisionId);
  assert.ok(d.steps.length >= 3 && d.steps.every((x) => x.ok));
  assert.equal(authorize(s, req({ principal: "dana" })).steps.length, 0, "no step strings without explain");
});

test("access.changed: a revoke takes effect on the next decision", async () => {
  const s = base(); grant(s, "g1");
  const e = s.epoch;
  assert.equal((await authorizeAsync(s, req({ principal: "dana" }))).effect, "allow");
  s.revokeGrant("g1");
  assert.ok(s.epoch > e);
  assert.equal(authorize(s, req({ principal: "dana" })).reason, "no_grant");
});

test("View as: needs access.view_as, cannot look through a higher clearance, always audited", () => {
  const s = base(); grant(s, "g1");
  const { principal: _p, ...rest } = req({ principal: "x" });
  assert.equal(viewAs(s, "dana", "sam", rest).reason, "role_lacks_permission");
  const d = viewAs(s, "boss", "dana", rest);
  assert.equal(d.effect, "allow"); assert.ok(d.obligations.some((o) => o.type === "audit" && o.class === "view_as"));
  assert.equal(viewAs(s, "boss", "ghost", rest).reason, "not_a_member");
  s.addPrincipalRole({ holder: "sam", role: "owner" });
  s.putRole({ id: "owner", clearance: 3, perms: ["records.read", "access.view_as"], name: "Owner" });
  s.putPrincipal({ id: "low", kind: "person", status: "active", name: "Low" }); s.addPrincipalRole({ holder: "low", role: "none" });
  s.putRole({ id: "none", clearance: 0, perms: ["access.view_as"], name: "None" });
  assert.equal(viewAs(s, "low", "boss", rest).reason, "above_clearance");
});
