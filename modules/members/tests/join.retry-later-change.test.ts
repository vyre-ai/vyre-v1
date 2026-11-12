// A join step that failed is tried again later, but an admin's change made in between always wins: the retry never gives back a role, a group, a project role or a channel that someone changed
// or took away after the join, and nothing is given to a person who was removed or is suspended. A retry of a step nobody touched still runs.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { consumers, drainJoins } from "../impl.ts";
import { harness, KEYS, NOW } from "../fixtures/db.ts";

const JOIN = { username: "dana", displayName: "Dana", password: "a long enough password", deviceName: "Dana's Mac", deviceClass: "desktop" as const, keys: KEYS };
const codeFrom = (link: string): string => decodeURIComponent(new URL(link).pathname.split("/").pop()!);
type H = ReturnType<typeof harness>;
const DANA = "usr_dana";

async function joinWithFailing(h: H, extra: Record<string, unknown>, failing: string): Promise<void> {
  const out = await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: `k-${failing}`, ...extra });
  h.world.failing.add(failing);
  assert.equal((await handlers["members.accept"](h.anon, { code: codeFrom(out.link), ...JOIN })).personId, DANA);
  h.world.failing.clear();
}
const stepOf = (h: H, k: string) => (JSON.parse(String(h.raw.rows("members_joins")[0]!["steps"])) as { k: string; state: string; dropped?: string }[]).find((s) => s.k === k)!;
const sh = (h: H) => ({ channel: [...(h.world.channelMembers.get("chn_a") ?? [])], project: h.world.projectRoles.get("prj_a")?.get(DANA), groups: h.world.principals.get(DANA)?.groups ?? [], roles: h.world.principals.get(DANA)?.roles ?? [] });

const cases: Array<{ name: string; extra: Record<string, unknown>; failing: string; step: string; change(h: H): Promise<void> | void; gone(h: H): boolean }> = [
  {
    name: "a channel the admin added then took the person out of",
    extra: { channels: ["chn_a"] }, failing: "channels.members.add", step: "channel:chn_a",
    // the admin put Dana in and took her out again: nothing is left of it in the channel, only in the events, which the members consumer sees
    change: async (h) => {
      const c = consumers["members.join_superseded"];
      h.world.channelMembers.set("chn_a", new Set([DANA]));
      await c.run(h.anon as never, { name: "channel.member_added", payload: { channelId: "chn_a", personId: DANA, by: "usr_admin" }, actor: "usr_admin" });
      h.world.channelMembers.set("chn_a", new Set());
      await c.run(h.anon as never, { name: "channel.member_removed", payload: { channelId: "chn_a", personId: DANA, by: "usr_admin" }, actor: "usr_admin" });
    },
    gone: (h) => !sh(h).channel.includes(DANA),
  },
  {
    name: "a project where the admin set another role",
    extra: { projects: ["prj_a"] }, failing: "projects.members.set", step: "project:prj_a",
    change: (h) => { h.world.projectRoles.set("prj_a", new Map([[DANA, "guest"]])); },
    gone: (h) => sh(h).project === "guest",
  },
  {
    name: "a role an admin gave and took back after the step failed (no trace in the person's roles; the audit log has it, read at retry time)",
    extra: { role: "rol_admin" }, failing: "access.roles.assign:rol_admin", step: "role:rol_admin",
    change: (h) => {
      for (const action of ["access.roles.assign", "access.roles.unassign"]) h.world.audit.push({ at: NOW + 1_000, actor: { kind: "person", id: "usr_admin" }, action, class: "admin", after: { targets: [{ kind: "role", id: "rol_admin" }, { kind: "person", id: DANA }] } });
    },
    gone: (h) => !sh(h).roles.includes("rol_admin"),
  },
  {
    name: "a group the admin put the person in and took them out of again (no trace left in the groups, only the change's time)",
    extra: { groups: ["grp_sales"] }, failing: "access.groups.add_member:grp_sales", step: "group:grp_sales",
    change: (h) => {
      for (const action of ["access.groups.add_member", "access.groups.remove_member"]) h.world.audit.push({ at: NOW + 1_000, actor: { kind: "person", id: "usr_admin" }, action, class: "admin", after: { targets: [{ kind: "group", id: "grp_sales" }, { kind: "person", id: DANA }] } });
    },
    gone: (h) => !sh(h).groups.includes("grp_sales"),
  },
];

for (const c of cases) {
  test(`a retry does not give back ${c.name}`, async () => {
    const h = harness();
    await joinWithFailing(h, c.extra, c.failing);
    assert.equal(stepOf(h, c.step).state, "failed");
    await c.change(h);
    await drainJoins(h.anon, undefined, { periodic: true });
    assert.ok(c.gone(h), `the admin's change stands: ${JSON.stringify(sh(h))}`);
    // never silent: the step stays among the failed ones admins see, as needing them, and member.join_stuck says so once
    assert.ok(stepOf(h, c.step).dropped, "the step was not given");
    const listed = (await handlers["members.joins.list"](h.as("usr_admin"), {})).joins.find((x: { personId: string }) => x.personId === DANA);
    assert.match(listed?.steps.find((x: { key: string }) => x.key === c.step)?.error ?? "", /changed this after they joined/, "admins see it as needing them");
    assert.equal(h.events.filter((e) => e.name === "member.join_stuck" && (e.payload as { step: string }).step === c.step).length, 1, "member.join_stuck says so once");
    await drainJoins(h.anon, undefined, { periodic: true });
    assert.ok(c.gone(h), "a later pass does not give it either");
    assert.equal(h.events.filter((e) => e.name === "member.join_stuck" && (e.payload as { step: string }).step === c.step).length, 1, "and does not say it again");
  });
}

test("one group step that failed is given on retry even though another group step of the same join worked meanwhile (Everyone is never lost)", async () => {
  const h = harness();
  await joinWithFailing(h, { groups: ["grp_sales"] }, "access.groups.add_member:grp_everyone");
  assert.equal(stepOf(h, "group:grp_everyone").state, "failed");
  assert.ok(sh(h).groups.includes("grp_sales"), "the other group step worked in the same pass");
  await drainJoins(h.anon, undefined, { periodic: true });
  assert.ok(sh(h).groups.includes("grp_everyone"), "Everyone is given");
  assert.equal(stepOf(h, "group:grp_everyone").state, "done");
  assert.equal(stepOf(h, "group:grp_everyone").dropped, undefined);
});

test("a step whose state could not be read when it failed is never given unchecked: it waits for an admin, said plainly", async () => {
  const h = harness();
  const out = await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", channels: ["chn_a"], idempotencyKey: "k-unread" });
  h.world.failing.add("channels.members.add");
  h.world.failing.add("channels.get");
  await handlers["members.accept"](h.anon, { code: codeFrom(out.link), ...JOIN });
  h.world.failing.clear();
  await drainJoins(h.anon, undefined, { periodic: true });
  assert.deepEqual(sh(h).channel, [], "not given");
  assert.ok(stepOf(h, "channel:chn_a").dropped);
  assert.equal(h.events.filter((e) => e.name === "member.join_stuck").length, 1);
  const listed = (await handlers["members.joins.list"](h.as("usr_admin"), {})).joins.find((x: { personId: string }) => x.personId === DANA);
  assert.equal(listed?.steps.find((x: { key: string }) => x.key === "channel:chn_a")?.error, "Vyre could not check this, so it left it. Give it by hand if it is still wanted.", "its own true line, not 'someone changed this'");
  h.world.channelMembers.set("chn_a", new Set([DANA]));   // an admin gives it by hand
  await drainJoins(h.anon, undefined, { periodic: true });
  assert.equal(stepOf(h, "channel:chn_a").state, "done", "it closes once the person holds it");
});

test("a retry gives nothing to a person who was removed, and waits while they are suspended; a step nobody touched still runs", async () => {
  const h = harness();
  await joinWithFailing(h, { channels: ["chn_a"] }, "channels.members.add");
  h.world.principals.get(DANA)!.status = "suspended";
  await drainJoins(h.anon, undefined, { periodic: true });
  assert.deepEqual(sh(h).channel, [], "nothing while suspended");
  assert.equal(stepOf(h, "channel:chn_a").state, "failed", "the step waits");
  h.world.principals.get(DANA)!.status = "active";
  await drainJoins(h.anon, undefined, { periodic: true });
  assert.deepEqual(sh(h).channel, [DANA], "nobody changed it: the retry runs");

  const g = harness();
  await joinWithFailing(g, { channels: ["chn_a"] }, "channels.members.add");
  g.world.principals.get(DANA)!.status = "removed";
  await drainJoins(g.anon, undefined, { periodic: true });
  assert.deepEqual(sh(g).channel, [], "a removed person is given nothing");
  assert.ok(stepOf(g, "channel:chn_a").dropped);
  assert.equal(stepOf(g, "channel:chn_a").state, "done", "a removed person's steps close");
});

test("only a change to that one role, made after the step failed, holds a role retry back; an unreadable audit log holds it back with its own plain line", async () => {
  const admin = (h: H, action: string, role: string, at: number) => h.world.audit.push({ at, actor: { kind: "person", id: "usr_admin" }, action, class: "admin", after: { targets: [{ kind: "role", id: role }, { kind: "person", id: DANA }] } });
  // another role changed after the failure, and this role changed before it: neither counts, the retry gives the role
  const h = harness();
  admin(h, "access.roles.assign", "rol_admin", NOW - 1);
  await joinWithFailing(h, { role: "rol_admin" }, "access.roles.assign:rol_admin");
  admin(h, "access.roles.assign", "rol_guest", NOW + 1_000);
  await drainJoins(h.anon, undefined, { periodic: true });
  assert.ok(sh(h).roles.includes("rol_admin"), "given");
  assert.equal(stepOf(h, "role:rol_admin").state, "done");
  // the audit log cannot be read: never given, and the line says so truly
  const g = harness();
  await joinWithFailing(g, { role: "rol_admin" }, "access.roles.assign:rol_admin");
  g.world.failing.add("audit.list");
  await drainJoins(g.anon, undefined, { periodic: true });
  assert.ok(!sh(g).roles.includes("rol_admin"), "not given unchecked");
  const listed = (await handlers["members.joins.list"](g.as("usr_admin"), {})).joins.find((x: { personId: string }) => x.personId === DANA);
  assert.equal(listed?.steps.find((x: { key: string }) => x.key === "role:rol_admin")?.error, "Vyre could not check this, so it left it. Give it by hand if it is still wanted.");
});
