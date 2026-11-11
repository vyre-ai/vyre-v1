// A guest invited from inside one chat (lane l-addsheet): the guest role, that one channel and what they may do in it, and nothing the Space gives everyone.
// @reads ../migrations/0003_guest_scope.sql
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, drainJoins } from "../impl.ts";
import { codeOf, harness, KEYS } from "../fixtures/db.ts";

const JOIN = { username: "sam", displayName: "Sam", password: "a long enough password", deviceName: "Sam's Mac", deviceClass: "desktop" as const, keys: KEYS };
const guest = async (h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}) =>
  handlers["members.invites.guest"]({ ...h.as("usr_admin"), depth: 1 } as never, { email: "Sam@Example.com", scope: { type: "channel", id: "chn_client" }, idempotencyKey: "g1", ...extra });
const codeFrom = (link: string): string => /\/join\/([A-Z0-9-]+)#fp=/.exec(link)![1]!;

test("members.invites.guest makes a guest invite for one channel by email, with the level kept beside it", async () => {
  const h = harness();
  const out = await guest(h, { level: "reply" });
  assert.deepEqual([out.invite.role, out.invite.channels, out.invite.groups, out.invite.agents, out.invite.projects, out.invite.email], ["rol_guest", ["chn_client"], [], [], [], "sam@example.com"]);
  assert.deepEqual(h.raw.rows("members_invite_scope").map((r) => [r["invite_id"], r["level"]]), [[out.invite.id, "reply"]]);
  assert.match(out.link, /\/join\/[A-Z0-9]{4}-[A-Z0-9]{4}#fp=/);
});

test("it is made from inside a chat only: a call from outside, a thread, a bad email or a bad level is refused and nothing is stored", async () => {
  const h = harness();
  const bad = async (call: () => Promise<unknown>, code: string, why: string): Promise<void> => { await assert.rejects(call, (e) => codeOf(e) === code, why); };
  await bad(() => handlers["members.invites.guest"](h.as("usr_admin"), { email: "a@b.co", scope: { type: "channel", id: "chn_client" }, idempotencyKey: "x" }), "permission.no_grant", "not a nested call");
  await bad(() => guest(h, { scope: { type: "thread", id: "thr_a" } }), "validation.bad_input", "only a channel");
  await bad(() => guest(h, { level: "edit" }), "validation.bad_input", "view or reply");
  await bad(() => guest(h, { email: "not an email" }), "validation.bad_input", "an email");
  assert.equal(h.raw.rows("members_invites").length, 0);
  assert.equal(h.raw.rows("members_invite_scope").length, 0);
});

test("a scoped guest joins with the guest role, that channel and the level they were invited at, and no Everyone group, home channel or company mailbox", async () => {
  const h = harness();
  const { invite, link } = await guest(h, { level: "reply" });
  h.calls.length = 0;
  await handlers["members.accept"](h.anon, { code: codeFrom(link), ...JOIN });
  assert.deepEqual(h.calls.map((c) => c.cap), ["invites.accept_create_account", "access.roles.assign", "channels.members.add", "access.join_share"]);
  const join = h.calls.find((c) => c.cap === "access.join_share")!.input as { resource: unknown; level: string; inviter: string; source: string; person: string };
  assert.deepEqual(join.resource, { type: "channel", id: "chn_client" });
  assert.deepEqual([join.level, join.inviter, join.source], ["use", "usr_admin", `invite:${invite.id}`]);
  assert.deepEqual(h.world.principals.get("usr_sam")!.roles, ["rol_guest"]);
  const steps = JSON.parse(String(h.raw.rows("members_joins")[0]!["steps"])) as { k: string; state: string }[];
  assert.deepEqual(steps.map((s) => s.k), ["role:rol_guest", "channel:chn_client", "grant:channel:chn_client:reply", "checklist"]);
  assert.ok(steps.every((s) => s.state === "done"));
});

test("a view guest is given View, and a step that fails is tried again without repeating the ones that worked", async () => {
  const h = harness();
  const { link } = await guest(h);
  h.world.failing.add("access.join_share");
  await handlers["members.accept"](h.anon, { code: codeFrom(link), ...JOIN });
  assert.deepEqual(await drainJoins(h.anon), { applied: 0, pending: 1 });
  h.world.failing.clear();
  h.calls.length = 0;
  assert.deepEqual(await drainJoins(h.anon), { applied: 1, pending: 0 });
  // the retry first reads what the Space holds for the step (a later change by an admin wins), then writes: of the writes, only the failed step ran again
  assert.deepEqual(h.calls.map((c) => c.cap).filter((c) => !["access.principals.get", "channels.get", "projects.members.list", "access.shares_of"].includes(c)), ["access.join_share"]);
  assert.equal((h.calls.find((c) => c.cap === "access.join_share")!.input as { level: string }).level, "view");
});

test("an ordinary invite is unchanged: Everyone, the home channel and the company step still run", async () => {
  const h = harness();
  const out = await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", channels: ["chn_a"], idempotencyKey: "ord" });
  await handlers["members.accept"](h.anon, { code: codeFrom(out.link), ...JOIN });
  const steps = JSON.parse(String(h.raw.rows("members_joins")[0]!["steps"])) as { k: string }[];
  assert.deepEqual(steps.map((s) => s.k), ["role:rol_member", "group:grp_everyone", "home", "channel:chn_a", "company", "checklist"]);
});
