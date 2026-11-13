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

const why = (s: AccessSnapshot, who: string, c: Cap, on: { type: string; id: string }): string => {
  const d = authorize(s, {
    principal: who,
    action: { perm: c.permission, level: c.level },
    resource: on,
    cap: c.name,
    now: NOW,
  });
  return d.effect === "allow" ? "allow" : d.reason;
};

test("a guest who owns a reply thread they opened is held to the table while the grant lives, and reaches nothing there when it is gone", () => {
  const s = world();
  s.putResource({ id: "thr_mine", type: "thread", parent_id: "thr_main", label: 0, owner_id: "usr_reply", holds: 0 });
  const on = { type: "thread", id: "thr_mine" };
  const by = (n: string): Cap => caps.find((c) => c.name === n)!;
  assert.equal(can(s, "usr_reply", by("engine.stop_all"), on), false, "owning it does not give stop");
  assert.equal(can(s, "usr_reply", by("chat.post"), on), true, "and they still post in it");
  // the channel grant is taken away: owning the thread gives nothing, not even reading, whatever the capability
  s.revokeGrant("g2");
  for (const c of caps.filter((x) => x.resource!.type === "thread"))
    assert.equal(can(s, "usr_reply", c, on), false, `no grant left: ${c.name}`);
  assert.equal(why(s, "usr_reply", by("chat.messages.list"), on), "no_grant");
  assert.equal(why(s, "usr_reply", by("threads.get"), { type: "thread", id: "thr_main" }), "no_grant");
  // the same when the grant has run out
  const lapsed = world();
  lapsed.putResource({
    id: "thr_mine",
    type: "thread",
    parent_id: "thr_main",
    label: 0,
    owner_id: "usr_reply",
    holds: 0,
  });
  lapsed.revokeGrant("g2");
  lapsed.putGrant({
    id: "g2b",
    subject_kind: "actor",
    subject_id: "usr_reply",
    resource_type: "channel",
    resource_id: "chn_a",
    level: "use",
    expires_at: 500,
  });
  assert.equal(why(lapsed, "usr_reply", by("chat.messages.list"), on), "expired");
  assert.equal(why(lapsed, "usr_reply", by("chat.post"), on), "expired");
});

test("the ceiling keys on what the person lacks, not on a role's name: a role cloned from Guest, a harmless custom role beside Guest, and a custom role that carries permissions", () => {
  const s = world();
  s.putRole({ id: "rol_client", clearance: 0, perms: [], name: "Client" }); // cloned from Guest by an admin: no permissions
  s.putRole({ id: "rol_tag", clearance: 0, perms: [], name: "Tagged" }); // a harmless custom role
  s.putRole({ id: "rol_staff", clearance: 1, perms: ["records.read"], name: "Staff" }); // carries permissions: its Space grant is what makes a member
  for (const id of ["usr_clone", "usr_both", "usr_staff"])
    s.putPrincipal({ id, kind: "person", status: "active", name: id });
  s.addPrincipalRole({ holder: "usr_clone", role: "rol_client" });
  s.addPrincipalRole({ holder: "usr_both", role: "rol_guest" });
  s.addPrincipalRole({ holder: "usr_both", role: "rol_tag" });
  s.addPrincipalRole({ holder: "usr_staff", role: "rol_staff" });
  s.putGrant({
    id: "gr_staff",
    subject_kind: "role",
    subject_id: "rol_staff",
    resource_type: "space",
    resource_id: "spc_x",
    level: "edit",
  });
  for (const id of ["usr_clone", "usr_both", "usr_staff"])
    s.putGrant({
      id: `gc_${id}`,
      subject_kind: "actor",
      subject_id: id,
      resource_type: "channel",
      resource_id: "chn_a",
      level: "use",
    });
  const stop = caps.find((c) => c.name === "engine.stop_all")!,
    post = caps.find((c) => c.name === "chat.post")!;
  const on = { type: "thread", id: "thr_main" };
  for (const who of ["usr_clone", "usr_both"]) {
    assert.equal(can(s, who, stop, on), false, `${who} is capped`);
    assert.equal(can(s, who, post, on), true, `${who} still replies`);
  }
  assert.equal(
    can(s, "usr_staff", stop, on),
    true,
    "a person whose custom role carries permissions has standing and is not capped",
  );
  // standing comes and goes with the role's Space grant: take it away and the same person is capped at once
  s.revokeGrant("gr_staff");
  assert.equal(can(s, "usr_staff", stop, on), false);
});

test("a channel's own label does not cover its chat: members of a labelled channel read it as they did when the chat lived under the Space", () => {
  const s = world();
  s.putResource({ id: "chn_a", type: "channel", parent_id: "spc_x", label: 2, owner_id: null, holds: 0 });
  assert.equal(s.effectiveLabel("chn_a"), 2, "the channel carries its label");
  assert.equal(s.effectiveLabel("thr_main"), 0, "its chat does not");
  assert.equal(s.effectiveLabel("thr_reply"), 0, "nor a reply thread");
  s.putResource({ id: "thr_own", type: "thread", parent_id: "thr_main", label: 1, owner_id: null, holds: 0 });
  assert.equal(s.effectiveLabel("thr_own"), 1, "a label on the thread itself still counts");
});
