// A join step that failed is tried again later, but an admin's change made in between always wins: the retry never gives back a role, a group, a project role or a channel that someone changed
// or took away after the join, and nothing is given to a person who was removed or is suspended. A retry of a step nobody touched still runs.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { consumers, drainJoins } from "../impl.ts";
import { harness, KEYS } from "../fixtures/db.ts";

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
    name: "a role, when the admin gave the person another role",
    extra: { role: "rol_admin" }, failing: "access.roles.assign:rol_admin", step: "role:rol_admin",
    change: (h) => { h.world.principals.get(DANA)!.roles = ["rol_guest"]; },
    gone: (h) => !sh(h).roles.includes("rol_admin"),
  },
  {
    name: "a group, when the admin changed the groups the person is in",
    extra: { groups: ["grp_sales"] }, failing: "access.groups.add_member:grp_sales", step: "group:grp_sales",
    change: (h) => { h.world.principals.get(DANA)!.groups.push("grp_other"); h.world.principals.get(DANA)!.groups = h.world.principals.get(DANA)!.groups.filter((g) => g !== "grp_sales"); },
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
    assert.equal(stepOf(h, c.step).state, "done");
    assert.ok(stepOf(h, c.step).dropped, "the step is closed as dropped, not as given");
  });
}

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
});
