// Permission exceptions on a live Server Space (owner, 3 Nov 2026: "per person exceptions too ... flexible ... connect it all properly"). An Allow and a Deny on a member and on a guest, a
// group exception and a person's own beating it, the Owner never restricted, an admin unable to give more than they hold, an end that lapses on its own with an audit row, and an outside agent
// acting for a restricted person refused. Every answer is the same one the gateway, identity.whoami's permissions and the app's gates read.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";
import { outsideAgent, tool } from "./support/vault-matrix.ts";

let h: Hour;
let m: Person;   // Aina, Member
let b: Person;   // Bilal, Member
let g: Person;   // Gus, Guest
let a: Person;   // Maya, Admin
const roles: Record<string, string> = {};
async function inviteAs(role: string, email: string): Promise<string> {
  const inv = await h.owner.call("members.invites.create", { role: roles[role]!, email });
  return decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
}
const perms = async (p: Person): Promise<string[]> => (await p.call("identity.whoami")).permissions as string[];
const set = (by: Person, input: Record<string, unknown>) => by.call("access.exceptions.set", { idempotencyKey: `x-${Math.random()}`, ...input });

before(async () => {
  h = await bootHour("exc");
  for (const r of (await h.owner.call("access.roles.list")).roles as { id: string; name: string }[]) roles[r.name] = r.id;
  m = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  b = h.person("Bilal", "bilal", "bilal@firm.test", "bilal horse battery staple 9");
  g = h.person("Gus", "gus", "gus@firm.test", "gus horse battery staple 9");
  a = h.person("Maya", "maya", "maya@firm.test", "maya horse battery staple 9");
  await join(h, m, await invite(h, m.email), { device: "web" });
  await join(h, b, await invite(h, b.email), { device: "web" });
  await join(h, g, await inviteAs("Guest", g.email), { device: "web" });
  await join(h, a, await inviteAs("Admin", a.email), { device: "web" });
});
after(async () => { await h?.stop(); });

test("a Deny on a member: her own automations are refused, whoami drops the permission, and removing it gives them back", async () => {
  const x = (await set(h.owner, { subject: { kind: "person", id: m.personId }, perms: ["automations.personal"], effect: "deny", why: "First week" })).exception;
  assert.ok(!(await perms(m)).includes("automations.personal"));
  await m.refused("automations.create", { name: "Nope", definition: { triggers: [{ key: "manual" }], nodes: [] } }, /^permission\.role_lacks_permission$/, "a Deny exception takes it away");
  const why = await h.owner.call("access.exceptions.explain", { principal: m.personId, perm: "automations.personal" });
  assert.equal(why.allowed, false);
  assert.match(why.words, /^Exception set by Irfad on .*, overrides Member: Allowed\. Reason: First week$/);
  await h.owner.call("access.exceptions.remove", { exceptionId: x.exceptionId });
  assert.ok((await perms(m)).includes("automations.personal"));
  await m.call("automations.create", { name: "Back", definition: { triggers: [{ key: "manual" }], nodes: [] } });
});

test("an Allow on a member: she promotes her own automation to the Space, which her role alone does not allow", async () => {
  const made = await m.call("automations.create", { name: "Intake", definition: { triggers: [{ key: "manual" }], nodes: [] } });
  await m.refused("automations.promote", { automationId: made.automation.id, confirm: true }, /^permission\./, "the Member role does not share to the Space");
  const x = (await set(h.owner, { subject: { kind: "person", id: m.personId }, perms: ["automations.space"], effect: "allow" })).exception;
  assert.ok((await perms(m)).includes("automations.space"));
  assert.equal((await m.call("automations.promote", { automationId: made.automation.id, confirm: true })).automation.kind, "space");
  await h.owner.call("access.exceptions.remove", { exceptionId: x.exceptionId });
});

test("a guest: an Allow lets him make folders in the folder shared with him, and his own Deny beats the group's Allow", async () => {
  const roots = (await h.owner.call("files.tree", {})).roots as Array<{ folderId?: string; kind: string }>;
  const folder = (await h.owner.call("files.folder.create", { name: "Client upload", parentId: roots.find((r) => r.kind === "folder" && r.folderId)!.folderId })).folder.folderId as string;
  await h.owner.call("access.share", { resource: { type: "folder", id: folder }, subject: { kind: "person", id: g.personId }, level: "edit", idempotencyKey: "share-g" });
  await g.refused("files.folder.create", { name: "Mine", parentId: folder }, /^permission\.role_lacks_permission$/, "a Guest holds no permission of his own");
  const team = (await h.owner.call("access.groups.create", { name: "Clients", members: [{ kind: "person", id: g.personId }], idempotencyKey: "grp-c" })).group.id as string;
  await set(h.owner, { subject: { kind: "group", id: team }, perms: ["files.write"], effect: "allow" });
  assert.ok((await perms(g)).includes("files.write"), "the group's Allow reaches him");
  await g.call("files.folder.create", { name: "Mine", parentId: folder });
  await set(h.owner, { subject: { kind: "person", id: g.personId }, perms: ["files.write"], effect: "deny", why: "Contract paused" });
  assert.ok(!(await perms(g)).includes("files.write"), "his own Deny beats the group's Allow");
  await g.refused("files.folder.create", { name: "Again", parentId: folder }, /^permission\.role_lacks_permission$/, "a person's exception beats a group's");
});

test("a group Deny takes a permission from its members; a member's own Allow beats it; the Owner is never restricted", async () => {
  const team = (await h.owner.call("access.groups.create", { name: "New starters", members: [{ kind: "person", id: m.personId }, { kind: "person", id: b.personId }], idempotencyKey: "grp-n" })).group.id as string;
  await set(h.owner, { subject: { kind: "group", id: team }, area: "agents", effect: "deny" });
  await b.refused("agents.create", { name: "Bot", role: "x" }, /^permission\.role_lacks_permission$/, "the group's Deny reaches its members");
  await set(h.owner, { subject: { kind: "person", id: m.personId }, perms: ["agents.create"], effect: "allow" });
  await m.call("agents.create", { name: "Aina's bot", role: "Helps." });
  await h.owner.refused("access.exceptions.set", { subject: { kind: "person", id: h.owner.personId }, perms: ["agents.create"], effect: "deny", idempotencyKey: "own" }, /^permission\.role_lacks_permission$/, "the Owner can't be restricted");
  await h.owner.call("access.groups.add_member", { groupId: team, member: { kind: "person", id: h.owner.personId } });
  await h.owner.call("agents.create", { name: "Owner bot", role: "x" });
});

test("an admin gives only what they hold: with automations.space taken from her, Maya cannot give it to Bilal", async () => {
  await set(h.owner, { subject: { kind: "person", id: a.personId }, perms: ["automations.space"], effect: "deny" });
  const err = await a.refused("access.exceptions.set", { subject: { kind: "person", id: b.personId }, perms: ["automations.space"], effect: "allow", idempotencyKey: "over" }, /^permission\.role_lacks_permission$/, "an admin cannot give more than they hold");
  assert.match(err.message, /only what you hold yourself/);
  await set(a, { subject: { kind: "person", id: b.personId }, perms: ["automations.space"], effect: "deny" });   // a restriction is never more than you hold
});

test("an end lapses on its own: the kernel stops honouring it at its end, and the lapse removes it with an audit row", async () => {
  const until = Date.now() + 1500;
  await set(h.owner, { subject: { kind: "person", id: b.personId }, perms: ["journeys.manage"], effect: "allow", until });
  assert.ok((await perms(b)).includes("journeys.manage"));
  await new Promise((r) => setTimeout(r, 1700));
  assert.ok(!(await perms(b)).includes("journeys.manage"), "past its end it no longer counts");
  await h.d.hooks!.runPeriodic("access.exceptions_lapse");
  const left = (await h.owner.call("access.exceptions.list", { subject: { kind: "person", id: b.personId } })).exceptions as Array<{ perms: string[] }>;
  assert.ok(!left.some((x) => x.perms.includes("journeys.manage")), "the lapse removed it");
  const rows = (await h.owner.call("audit.list", { q: "access.exceptions.lapse" })).rows as Array<{ action: string }>;
  assert.ok(rows.some((r) => r.action === "access.exceptions.lapse"), `the audit log has the lapse: ${JSON.stringify(rows.slice(0, 3))}`);
});

test("an outside agent acting for a restricted person is refused what she is refused", async () => {
  await set(h.owner, { subject: { kind: "person", id: m.personId }, perms: ["automations.personal"], effect: "deny" });
  const agent = await outsideAgent(h.d, m.token!, false);
  const t = await tool(agent.c, "automations_create", { name: "From my agent", definition: { triggers: [{ key: "manual" }], nodes: [] }, idempotencyKey: "agent-a" });
  assert.equal(t.isError, true, t.text);
  assert.match(t.text, /person you act for cannot do this either/i, t.text);
});
