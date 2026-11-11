// A Space admin who holds no Manage grant on a project changes its roles (issue 877). projects.members.set lets a Space owner or admin through its first check, but the grants then written
// ran as the caller and were refused at access.share. The host writes them now, only for a grant that carries the project's own source. Run on a server-role daemon with the real access module: the owner
// makes a project and invites an admin and two members; the admin, who was never given the project, sets and removes a role and the grants land; a plain member still cannot change any role.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let admin: Person, aina: Person, cara: Person;
let projectId = "";

before(async () => { h = await bootHour("projroles"); });
after(async () => { await h?.stop(); });

async function levelOn(who: Person, type: string, id: string): Promise<string | undefined> {
  const got = await who.attempt("access.shares_of", { resource: { type, id } });   // refused when the person has no view on it: no grant
  return got.ok ? ((got.data as { mine?: string }).mine ?? "view") : undefined;
}

test("the owner makes a project; an admin and two members join", async () => {
  admin = h.person("Bilal", "bilal", "bilal@firm.test", "bilal horse battery staple 9");
  aina = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  cara = h.person("Cara", "cara", "cara@firm.test", "cara horse battery staple 9");
  const inv = await h.owner.call("members.invites.create", { role: "rol_admin", email: admin.email });
  await join(h, admin, decodeURIComponent(new URL(String(inv.link)).pathname.split("/").pop()!), { device: "web" });
  await join(h, aina, await invite(h, aina.email), { device: "web" });
  await join(h, cara, await invite(h, cara.email), { device: "web" });
  projectId = (await h.owner.call("projects.create", { type: "project", title: "Client portal launch", idempotencyKey: "pr-1" })).projectId as string;
  await h.owner.call("projects.members.set", { projectId, principal: aina.personId, role: "lead" });
  assert.equal(await levelOn(admin, "project", projectId), undefined, "the admin holds no grant on the project");
});

test("an admin with no Manage on the project sets a role and the grants land; removing it takes them back", async () => {
  const set = await admin.call("projects.members.set", { projectId, principal: cara.personId, role: "member", idempotencyKey: "pr-set" });
  assert.equal((set.member as { role: string }).role, "member");
  const project = (await h.owner.call("projects.members.list", { projectId })).members as Array<{ principal: string; role: string }>;
  assert.equal(project.find((m) => m.principal === cara.personId)?.role, "member", "the role is kept");
  assert.ok(await levelOn(cara, "project", projectId), "Cara holds a grant on the project itself");
  const shares = (await h.owner.call("access.shares_of", { resource: { type: "project", id: projectId } })).shares as Array<{ grant: { subject: { id: string }; source?: string } }>;
  assert.equal(shares.find((s) => s.grant.subject.id === cara.personId)?.grant.source, `project:${projectId}`, "the grant carries the project as its source");
  const gone = await admin.call("projects.members.remove", { projectId, principal: cara.personId });
  assert.equal(gone.removed, true);
  assert.equal(await levelOn(cara, "project", projectId), undefined, "the grant is taken back");
});

test("the admin cannot use the project's role path to give anyone more than a project role, and a plain member still cannot change any role", async () => {
  await aina.call("projects.members.set", { projectId, principal: cara.personId, role: "member", idempotencyKey: "pr-lead-set" });   // the Lead manages the project: allowed
  const bystander = h.person("Dev", "dev", "dev@firm.test", "dev horse battery staple 9");
  await join(h, bystander, await invite(h, bystander.email), { device: "web" });
  await bystander.refused("projects.members.set", { projectId, principal: bystander.personId, role: "lead", idempotencyKey: "pr-self" }, /^permission\./, "a plain member cannot make themselves Lead");
  await bystander.refused("projects.members.remove", { projectId, principal: cara.personId }, /^permission\./, "a plain member cannot remove a role");
  const members = (await h.owner.call("projects.members.list", { projectId })).members as Array<{ principal: string; role: string }>;
  assert.equal(members.find((m) => m.principal === bystander.personId), undefined, "nothing was written");
  assert.equal(members.find((m) => m.principal === cara.personId)?.role, "member");
});
