// l-perms (owner 3 Nov): "anything in a person's own scope is allowed for every member ... automations and things like that to your scope should all be allowed." On a Server Space at its own
// address, an invited Member makes and runs a Mine automation, connects an app as their own, keeps a Mine skill and Vault folder and makes their own agent; what is the Space's (promoting the
// automation to the Space, a Space connection, inviting, changing roles) is refused in plain words. A Guest opens the app (who they are, the Space, its Kit) and is refused what is not shared
// with them. identity.whoami carries each person's permissions, which the app uses to hide what they cannot do.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join, unexpectedRefusals } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let m: Person;
let g: Person;
before(async () => {
  h = await bootHour("perms");
  m = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  await join(h, m, await invite(h, m.email), { device: "web" });
  const roles = (await h.owner.call("access.roles.list")).roles as { id: string; name: string }[];
  const inv = await h.owner.call("members.invites.create", { role: roles.find((r) => r.name === "Guest")!.id, email: "gus@firm.test" });
  g = h.person("Gus", "gus", "gus@firm.test", "gus horse battery staple 9");
  await join(h, g, decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!), { device: "web" });
});
after(async () => { await h?.stop(); });

test("a member makes, turns on and runs a Mine automation; promoting it to the Space is an admin's", async () => {
  const made = await m.call("automations.create", { name: "Morning check", definition: { triggers: [{ key: "manual" }], nodes: [] } });
  const id = String(made.automation.id);
  await m.call("automations.set_enabled", { automationId: id, enabled: true });
  const run = await m.call("automations.run", { automationId: id });
  assert.ok(String(run.runId).length > 0, "the run started");
  const listed = (await m.call("automations.list", {})).automations as Array<{ id: string }>;
  assert.ok(listed.some((a) => a.id === id), "it is in her list");
  await m.refused("automations.promote", { automationId: id, confirm: true }, /^permission\./, "a Space automation is an admin's to make");
});

test("a member keeps their own things: a Mine connection, skill, Vault folder and agent; a Space connection and inviting are refused in plain words", async () => {
  const connectors = (await h.owner.call("connectors.list", {})).connectors as Array<{ key: string; scope: string; state: string }>;
  const own = connectors.find((c) => c.scope === "person" && c.state === "live");
  const space = connectors.find((c) => c.scope === "space" && c.state === "live");
  assert.ok(own && space, "the Space has a live person connector (Dropbox) and a Space one to try");
  const c = await m.call("connections.create", { connector: own.key, title: "Mine", ownerKind: "person", idempotencyKey: "own-conn" });
  assert.ok(c.connection.connectionId, "her own connection is made: connectors.manage is not needed for it");
  await m.refused("connections.create", { connector: space.key, title: "Team", ownerKind: "space", idempotencyKey: "space-conn" }, /^permission\.role_lacks_permission$/, "a Space connection is an admin's");
  await m.call("skills.mine.add", { text: "---\nname: tidy-notes\ndescription: Tidy my notes\n---\nTidy them." });
  await m.call("vault.folders.create", { name: "My keys", scope: "mine", idempotencyKey: "mine-folder" });
  await m.call("agents.create", { name: "Aina's helper", role: "Helps Aina." });
  await m.refused("members.invites.create", { email: "x@firm.test", role: "rol_member" }, /^permission\./, "inviting is an admin's");
});

test("whoami carries each role's permissions: the member holds automations.personal and not automations.space or console.access", async () => {
  const mine = (await m.call("identity.whoami")).permissions as string[];
  for (const k of ["automations.personal", "agents.create", "records.create", "files.write", "sites.deploy"]) assert.ok(mine.includes(k), `a member holds ${k}`);
  for (const k of ["automations.space", "console.access", "members.invite", "access.manage", "connectors.manage"]) assert.ok(!mine.includes(k), `a member does not hold ${k}`);
  const owner = (await h.owner.call("identity.whoami")).permissions as string[];
  assert.ok(owner.includes("access.manage") && owner.includes("automations.space"), "the owner holds everything");
});

test("a guest opens the app (who they are, the Space, its Kit, the switcher tile) and is refused making things in the Space", async () => {
  const who = await g.call("identity.whoami");
  assert.deepEqual(who.permissions, [], "a guest's role carries no permission of its own");
  assert.ok((await g.call("spaces.get")).space.id, "the guest reads the Space");
  await g.call("spaces.switcher");
  await g.call("settings.kit.get");
  await g.refused("automations.create", { name: "Nope", definition: { triggers: [{ key: "manual" }], nodes: [] } }, /^permission\./, "a guest works in what is shared with them");
  await g.refused("agents.create", { name: "Nope", role: "x" }, /^permission\./, "a guest makes no agents");
});

test("the member met no refusal the walk did not mean", () => {
  assert.deepEqual(unexpectedRefusals(h, [m]), []);
});
