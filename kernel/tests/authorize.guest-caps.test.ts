// @reads /generated/registry.json
// What a guest holds on a thread or a channel (lane f-guest, 13 Nov 2026): the grant says the level, kernel/src/authorize/guest-caps.ts says what that level may do, whichever door the grant came through.
// The ratchet: every capability the kernel can check on a thread or a channel is classified in that table, and a capability added later and not classified fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AccessSnapshot, authorize, rankOf } from "../src/authorize/index.ts";
import { GUEST_CAPS, GUEST_TYPES } from "../src/authorize/guest-caps.ts";

type Cap = {
  name: string;
  level: "view" | "use" | "edit" | "manage";
  permission: string | null;
  resource?: { type: string };
};
const caps = (
  JSON.parse(readFileSync(new URL("../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: Cap[] }
).capabilities.filter((c) => c.resource !== undefined && GUEST_TYPES.has(c.resource.type));
const NOW = 1_000;

function world(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "rol_member", clearance: 1, perms: [], name: "Member" });
  s.putRole({ id: "rol_guest", clearance: 0, perms: [], name: "Guest" });
  s.putResource({ id: "spc_x", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "chn_a", type: "channel", parent_id: "spc_x", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "thr_main", type: "thread", parent_id: "chn_a", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "thr_reply", type: "thread", parent_id: "thr_main", label: 0, owner_id: null, holds: 0 });
  s.putResource({ id: "thr_shared", type: "thread", parent_id: "spc_x", label: 0, owner_id: null, holds: 0 });
  for (const [id, kind] of [
    ["usr_view", "person"],
    ["usr_reply", "person"],
    ["usr_member", "person"],
    ["agt_low", "agent"],
  ] as const)
    s.putPrincipal({ id, kind, status: "active", name: id, ...(kind === "agent" ? { owner: "usr_member" } : {}) });
  for (const g of ["usr_view", "usr_reply", "agt_low"]) s.addPrincipalRole({ holder: g, role: "rol_guest" });
  s.addPrincipalRole({ holder: "usr_member", role: "rol_member" });
  s.putGrant({
    id: "g1",
    subject_kind: "actor",
    subject_id: "usr_view",
    resource_type: "channel",
    resource_id: "chn_a",
    level: "view",
  });
  s.putGrant({
    id: "g2",
    subject_kind: "actor",
    subject_id: "usr_reply",
    resource_type: "channel",
    resource_id: "chn_a",
    level: "use",
  });
  // another door: a thread shared with the guest directly, at Edit
  s.putGrant({
    id: "g3",
    subject_kind: "actor",
    subject_id: "usr_reply",
    resource_type: "thread",
    resource_id: "thr_shared",
    level: "edit",
  });
  s.putGrant({
    id: "g4",
    subject_kind: "actor",
    subject_id: "usr_member",
    resource_type: "space",
    resource_id: "spc_x",
    level: "manage",
  });
  s.putGrant({
    id: "g5",
    subject_kind: "actor",
    subject_id: "agt_low",
    resource_type: "thread",
    resource_id: "thr_main",
    level: "use",
  });
  return s;
}
const can = (s: AccessSnapshot, who: string, c: Cap, on: { type: string; id: string }): boolean =>
  authorize(s, { principal: who, action: { perm: c.permission, level: c.level }, resource: on, cap: c.name, now: NOW })
    .effect === "allow";

test("every capability on a thread or a channel is classified for guests", () => {
  assert.ok(caps.length > 100, `the registry lists ${caps.length} thread and channel capabilities`);
  const unclassified = caps.filter((c) => GUEST_CAPS[c.name] === undefined).map((c) => c.name);
  assert.deepEqual(unclassified, [], "classify these in kernel/src/authorize/guest-caps.ts (view, reply or never)");
  const gone = Object.keys(GUEST_CAPS).filter((n) => !caps.some((c) => c.name === n));
  assert.deepEqual(gone, [], "the table names capabilities that are not on a thread or a channel any more");
});

test("a view guest and a reply guest get exactly what the table says, in the channel's chat and in a reply thread under it", () => {
  const s = world();
  for (const on of [
    { type: "thread", id: "thr_main" },
    { type: "thread", id: "thr_reply" },
    { type: "channel", id: "chn_a" },
  ])
    for (const c of caps) {
      if (c.resource!.type !== on.type) continue;
      const what = GUEST_CAPS[c.name];
      const perm = c.permission === null; // a capability behind a permission is refused the guest role whatever the table says
      assert.equal(
        can(s, "usr_view", c, on),
        perm && what === "view" && rankOf(c.level) <= rankOf("view"),
        `view guest: ${c.name} on ${on.id}`,
      );
      assert.equal(
        can(s, "usr_reply", c, on),
        perm && (what === "view" || what === "reply") && rankOf(c.level) <= rankOf("use"),
        `reply guest: ${c.name} on ${on.id}`,
      );
    }
});

test("the ceiling holds for a thread shared with the guest by another door, at a higher level", () => {
  const s = world();
  for (const c of caps.filter((x) => x.resource!.type === "thread")) {
    const what = GUEST_CAPS[c.name];
    assert.equal(
      can(s, "usr_reply", c, { type: "thread", id: "thr_shared" }),
      c.permission === null && (what === "view" || what === "reply") && rankOf(c.level) <= rankOf("edit"),
      `shared thread, edit grant: ${c.name}`,
    );
  }
  for (const n of [
    "engine.stop_all",
    "chat.helper.start",
    "chat.handoff",
    "threads.set_mode",
    "threads.update",
    "chat.pin",
  ])
    assert.equal(
      can(s, "usr_reply", caps.find((c) => c.name === n)!, { type: "thread", id: "thr_shared" }),
      false,
      `${n} on the shared thread`,
    );
});

test("nothing else changes: a member, and an agent that holds the Guest role as its low role, keep every capability their grant reaches", () => {
  const s = world();
  const stop = caps.find((c) => c.name === "engine.stop_all")!,
    start = caps.find((c) => c.name === "chat.helper.start")!;
  assert.equal(can(s, "usr_member", stop, { type: "thread", id: "thr_main" }), true);
  assert.equal(can(s, "usr_member", start, { type: "thread", id: "thr_reply" }), true);
  assert.equal(
    authorize(s, {
      principal: "agt_low",
      actingFor: "usr_member",
      action: { perm: null, level: "use" },
      resource: { type: "thread", id: "thr_main" },
      cap: stop.name,
      now: NOW,
    }).effect,
    "allow",
    "an agent is never a guest",
  );
});

test("a check that names no capability (a list, a sync filter, a handler's own check) rests on the grant alone, and an unlisted capability is refused", () => {
  const s = world();
  assert.equal(
    authorize(s, {
      principal: "usr_view",
      action: { perm: null, level: "view" },
      resource: { type: "thread", id: "thr_main" },
      now: NOW,
    }).effect,
    "allow",
  );
  assert.equal(
    authorize(s, {
      principal: "usr_reply",
      action: { perm: null, level: "use" },
      resource: { type: "thread", id: "thr_main" },
      cap: "chat.not_classified_yet",
      now: NOW,
    }).effect,
    "deny",
  );
});
