// Invites and the join (spec 3.13, golden 2): an invite carries a role, groups and starting places; accepting it makes the account through identity, then the person gets
// their role, the Everyone group, the invite's groups, projects, channels and agents, and the first-run checklist. The code is shown once and stored as a hash.
// @reads ../migrations/0001_members.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlers } from "../impl.ts";
import { drainJoins, invitesSeam } from "../impl.ts";
import { codeOf, harness, KEYS } from "../fixtures/db.ts";

const DAY = 24 * 3_600_000;
const JOIN = { username: "dana", displayName: "Dana", password: "a long enough password", deviceName: "Dana's Mac", deviceClass: "desktop" as const, keys: KEYS };

function codeFrom(link: string): string {
  const m = /\/join\/([A-Z0-9-]+)#fp=([0-9a-f]+)$/.exec(link);
  assert.ok(m, `link shape: ${link}`);
  return m![1]!;
}
async function invite(h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}, key = "k1") {
  const out = await handlers["members.invites.create"](h.as("usr_admin"), { role: "rol_member", idempotencyKey: key, ...extra });
  return { ...out, code: codeFrom(out.link) };
}

test("the module answers all 17 capabilities and the migration names its tables", () => {
  assert.equal(Object.keys(handlers).length, 17);
  for (const [k, fn] of Object.entries(handlers)) assert.equal(typeof fn, "function", k);
  const sql = readFileSync(new URL("../migrations/0001_members.sql", import.meta.url), "utf8");
  for (const t of ["members_invites", "members_joins", "members_status", "members_policy"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`));
});

test("an invite is a link with the address, a one-time code and the key fingerprint; the code is stored only as a hash", async () => {
  const h = harness();
  const { invite: inv, link, code } = await invite(h, { groups: ["grp_sales"], projects: ["prj_a"], channels: ["chn_a"], agents: ["agt_a"], email: " Dana@Example.com " });
  assert.match(link, /^https:\/\/maya\.vyre\.run\/join\/[A-Z0-9]{4}-[A-Z0-9]{4}#fp=ab12cd34ef567890$/);
  assert.equal(inv.state, "open");
  assert.equal(inv.email, "dana@example.com");
  assert.equal(inv.expiresAt, h.now() + 7 * DAY);
  assert.deepEqual([inv.groups, inv.projects, inv.channels, inv.agents], [["grp_sales"], ["prj_a"], ["chn_a"], ["agt_a"]]);
  const stored = JSON.stringify(h.raw.rows("members_invites"));
  assert.ok(!stored.includes(code) && !stored.includes(code.replace("-", "")), "the code is nowhere in the table");
  assert.ok(!JSON.stringify(h.events).includes(code), "or in an event");
  assert.deepEqual(h.events.map((e) => e.name), ["member.invited"]);
  assert.deepEqual(h.events[0]!.payload, { inviteId: inv.id, role: "rol_member", expiresAt: inv.expiresAt });
});

test("what an invite may ask for is checked before anything is written", async () => {
  const h = harness();
  const a = h.as("usr_admin");
  const base = { role: "rol_member", idempotencyKey: "x" };
  const bad = async (input: Record<string, unknown>, want: string, key: string) =>
    assert.rejects(handlers["members.invites.create"](a, { ...base, ...input, idempotencyKey: key }), (e) => codeOf(e) === want, key);
  await bad({ role: "rol_owner" }, "validation.precondition_failed", "owner");
  await bad({ role: "rol_nobody" }, "validation.not_found", "role");
  await bad({ groups: ["grp_missing"] }, "validation.not_found", "group");
  await bad({ groups: ["sales"] }, "validation.bad_input", "group prefix");
  await bad({ projects: ["chn_x"] }, "validation.bad_input", "project prefix");
  await bad({ email: "not-an-email" }, "validation.bad_input", "email");
  await bad({ expiresInDays: 0 }, "validation.bad_input", "days low");
  await bad({ expiresInDays: 91 }, "validation.bad_input", "days high");
  assert.equal(h.raw.rows("members_invites").length, 0);
  assert.equal(h.events.length, 0);
  h.world.host = undefined;
  await bad({}, "validation.precondition_failed", "no address");
  h.world.host = "maya.vyre.run";
  await invite(h, { email: "dana@example.com" }, "first");
  await bad({ email: "DANA@example.com" }, "validation.duplicate", "same email twice");
  const dup = await invite(h, { groups: ["grp_sales", "grp_sales", "grp_everyone"] }, "dedupe");
  assert.deepEqual(dup.invite.groups, ["grp_sales"], "groups are de-duplicated and Everyone is implied");
});

test("the join page preview shows the Space, who invited, the role and the fingerprint; a bad, revoked or used code all read as invalid", async () => {
  const h = harness();
  const { code, invite: inv } = await invite(h);
  const view = await handlers["members.invites.preview"](h.anon, { code });
  assert.deepEqual(view, { spaceName: "Maya Studio", invitedBy: "Ada", role: "Member", expiresAt: inv.expiresAt, fingerprint: "ab12 cd34 ef56 7890" });
  // people type codes: lower case, no dash and stray spaces all work
  assert.equal((await handlers["members.invites.preview"](h.anon, { code: ` ${code.toLowerCase().replace("-", " ")} ` })).spaceName, "Maya Studio");
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code: "ZZZZ-ZZZZ" }), (e) => codeOf(e) === "auth.invalid_code");
  await handlers["members.invites.revoke"](h.as("usr_admin"), { inviteId: inv.id });
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code }), (e) => codeOf(e) === "auth.invalid_code");
});

test("golden 2: accepting makes the account, the role, Everyone and the invite's groups, projects, channels, agents and the checklist, in order", async () => {
  const h = harness();
  const { code, invite: inv } = await invite(h, { role: "rol_admin", groups: ["grp_sales"], projects: ["prj_a"], channels: ["chn_a"], agents: ["agt_a"] });
  h.events.length = 0;
  h.calls.length = 0;
  const out = await handlers["members.accept"](h.anon, { code, ...JOIN });
  assert.deepEqual(out, { personId: "usr_dana", sessionId: "ses_1", token: "vst_token", epoch: 1 });
  // the trace: identity makes the person, then the effects run
  assert.deepEqual(h.calls.map((c) => c.cap), [
    "invites.accept_create_account",
    "access.roles.assign", "access.groups.add_member", "access.groups.add_member", "projects.members.set", "channels.members.add", "access.share",
  ]);
  assert.deepEqual(h.events.map((e) => e.name), ["principal.created", "member.joined"], "identity emits these once; members.accept does not repeat them");
  const dana = h.world.principals.get("usr_dana")!;
  assert.deepEqual(dana.roles, ["rol_admin"]);
  assert.deepEqual(dana.groups.sort(), ["grp_everyone", "grp_sales"]);
  assert.deepEqual(h.calls.find((c) => c.cap === "projects.members.set")!.input, { projectId: "prj_a", principal: "usr_dana", role: "member" });
  assert.deepEqual(h.calls.find((c) => c.cap === "channels.members.add")!.input, { channelId: "chn_a", personIds: ["usr_dana"] });
  assert.deepEqual((h.calls.find((c) => c.cap === "access.share")!.input as { resource: unknown; level: string }).level, "use");
  const row = h.raw.rows("members_invites")[0]!;
  assert.equal(row["state"], "accepted");
  assert.equal(row["accepted_by"], "usr_dana");
  const join = h.raw.rows("members_joins")[0]!;
  assert.equal(join["state"], "applied");
  const steps = JSON.parse(String(join["steps"])) as { k: string; state: string }[];
  assert.deepEqual(steps.map((s) => s.k), ["role:rol_admin", "group:grp_everyone", "group:grp_sales", "project:prj_a", "channel:chn_a", "agent:agt_a", "checklist"]);
  assert.ok(steps.every((s) => s.state === "done"));
  // the code works once
  await assert.rejects(handlers["members.accept"](h.anon, { code, ...JOIN, username: "dana2" }), (e) => codeOf(e) === "auth.invalid_code");
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code }), (e) => codeOf(e) === "auth.invalid_code");
  assert.equal((await handlers["members.invites.list"](h.as("usr_admin"), { state: "accepted" })).invites[0]!.acceptedBy, "usr_dana");
  assert.equal(inv.state, "open", "the view returned at creation was a snapshot");
});

test("a join step that fails is kept and retried later; a step that worked is never run twice", async () => {
  const h = harness();
  const { code } = await invite(h, { channels: ["chn_a"] });
  h.world.failing.add("channels.members.add");
  const out = await handlers["members.accept"](h.anon, { code, ...JOIN });
  assert.equal(out.personId, "usr_dana", "the person still joins");
  let join = h.raw.rows("members_joins")[0]!;
  assert.equal(join["state"], "pending");
  const failed = (JSON.parse(String(join["steps"])) as { k: string; state: string; error?: string; tries: number }[]).filter((s) => s.state !== "done");
  assert.deepEqual(failed.map((s) => [s.k, s.state, s.tries]), [["channel:chn_a", "failed", 1]]);
  assert.match(failed[0]!.error!, /internal\.unexpected/);
  h.world.failing.clear();
  h.calls.length = 0;
  assert.deepEqual(await drainJoins(h.anon), { applied: 1, pending: 0 });
  assert.deepEqual(h.calls.map((c) => c.cap), ["channels.members.add"], "only the failed step ran again");
  join = h.raw.rows("members_joins")[0]!;
  assert.equal(join["state"], "applied");
  assert.deepEqual(await drainJoins(h.anon), { applied: 0, pending: 0 });
});

test("the seam identity calls: peek never spends, accept spends once and queues the effects", async () => {
  const h = harness();
  const { code, invite: inv } = await invite(h, { groups: ["grp_ops"] });
  const seam = invitesSeam(h.anon);
  assert.deepEqual(seam.peek(code), { inviteId: inv.id, role: "rol_member", groups: ["grp_ops"], invitedBy: "usr_admin" });
  assert.deepEqual(seam.peek(code), seam.peek(code), "peeking twice changes nothing");
  assert.equal(seam.peek("nope-nope"), "invalid");
  assert.equal(seam.peek("  "), "invalid");
  h.world.principals.set("usr_eve", { id: "usr_eve", kind: "person", name: "Eve", status: "active", roles: [], groups: [] });
  seam.accept(inv.id, "usr_eve");
  seam.accept(inv.id, "usr_eve");
  assert.throws(() => seam.accept(inv.id, "usr_mallory"), (e) => codeOf(e) === "auth.invalid_code");
  assert.equal(seam.peek(code), "invalid");
  assert.equal(h.raw.rows("members_joins").length, 1);
  assert.deepEqual(await drainJoins(h.anon), { applied: 1, pending: 0 });
  assert.deepEqual(h.world.principals.get("usr_eve")!.groups.sort(), ["grp_everyone", "grp_ops"]);
  assert.deepEqual(h.world.principals.get("usr_eve")!.roles, ["rol_member"]);
});

test("expiry: an open invite past its date is expired, can be extended, and cannot be used meanwhile", async () => {
  const h = harness();
  const a = h.as("usr_admin");
  const { code, invite: inv } = await invite(h, { expiresInDays: 2 });
  h.advance(3 * DAY);
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code }), (e) => codeOf(e) === "auth.expired");
  await assert.rejects(handlers["members.accept"](h.anon, { code, ...JOIN }), (e) => codeOf(e) === "auth.expired");
  assert.equal(h.raw.rows("members_joins").length, 0, "an expired invite makes no account");
  assert.equal((await handlers["members.invites.list"](a, { state: "expired" })).invites.length, 1);
  assert.equal((await handlers["members.invites.list"](a, { state: "open" })).invites.length, 0);
  await assert.rejects(handlers["members.invites.extend"](a, { inviteId: inv.id, expiresInDays: 0 }), (e) => codeOf(e) === "validation.bad_input");
  const ext = await handlers["members.invites.extend"](a, { inviteId: inv.id, expiresInDays: 10 });
  assert.equal(ext.invite.state, "open");
  assert.equal(ext.invite.expiresAt, h.now() + 10 * DAY);
  assert.equal((await handlers["members.invites.preview"](h.anon, { code })).spaceName, "Maya Studio");
  await handlers["members.accept"](h.anon, { code, ...JOIN });
  await assert.rejects(handlers["members.invites.extend"](a, { inviteId: inv.id, expiresInDays: 5 }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(handlers["members.invites.extend"](a, { inviteId: "inv_missing", expiresInDays: 5 }), (e) => codeOf(e) === "validation.not_found");
});

test("revoking stops the code, says so once, and refuses an invite that was already used", async () => {
  const h = harness();
  const a = h.as("usr_admin");
  const one = await invite(h, {}, "one");
  const two = await invite(h, {}, "two");
  h.events.length = 0;
  await handlers["members.invites.revoke"](a, { inviteId: one.invite.id });
  await handlers["members.invites.revoke"](a, { inviteId: one.invite.id });
  assert.deepEqual(h.events.map((e) => e.name), ["member.invite_revoked"]);
  await assert.rejects(handlers["members.accept"](h.anon, { code: one.code, ...JOIN }), (e) => codeOf(e) === "auth.invalid_code");
  await handlers["members.accept"](h.anon, { code: two.code, ...JOIN });
  await assert.rejects(handlers["members.invites.revoke"](a, { inviteId: two.invite.id }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(handlers["members.invites.extend"](a, { inviteId: one.invite.id, expiresInDays: 3 }), (e) => codeOf(e) === "validation.precondition_failed");
});

test("creating twice with one idempotency key gives the same invite and a fresh code, and only the fresh code works", async () => {
  const h = harness();
  const first = await invite(h, {}, "same");
  const again = await invite(h, {}, "same");
  assert.equal(again.invite.id, first.invite.id);
  assert.notEqual(again.code, first.code);
  assert.equal(h.raw.rows("members_invites").length, 1);
  assert.equal(h.events.filter((e) => e.name === "member.invited").length, 1);
  await assert.rejects(handlers["members.invites.preview"](h.anon, { code: first.code }), (e) => codeOf(e) === "auth.invalid_code");
  assert.equal((await handlers["members.invites.preview"](h.anon, { code: again.code })).spaceName, "Maya Studio");
  await handlers["members.invites.revoke"](h.as("usr_admin"), { inviteId: first.invite.id });
  await assert.rejects(invite(h, {}, "same"), (e) => codeOf(e) === "validation.precondition_failed");
});

test("the list pages newest first and filters by state", async () => {
  const h = harness();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push((await invite(h, {}, `k${i}`)).invite.id);
    h.advance(1000);
  }
  const a = h.as("usr_admin");
  const p1 = await handlers["members.invites.list"](a, { limit: 2 });
  assert.deepEqual(p1.invites.map((x) => x.id), [ids[4], ids[3]]);
  assert.equal(p1.total, 5);
  const p2 = await handlers["members.invites.list"](a, { limit: 2, cursor: p1.next! });
  assert.deepEqual(p2.invites.map((x) => x.id), [ids[2], ids[1]]);
  assert.equal((await handlers["members.invites.list"](a, { limit: 2, cursor: "4" })).next, undefined);
  await handlers["members.invites.revoke"](a, { inviteId: ids[0]! });
  assert.deepEqual((await handlers["members.invites.list"](a, { state: "revoked" })).invites.map((x) => x.id), [ids[0]]);
});
