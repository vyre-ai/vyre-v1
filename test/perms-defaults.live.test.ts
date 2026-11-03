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

test("a Space automation: the member reads and runs it and makes a copy; changing, turning off or deleting it is refused until the owner gives her Edit on it", async () => {
  const made = await h.owner.call("automations.create", { name: "Team intake", definition: { triggers: [{ key: "manual" }], nodes: [] } });
  const id = String(made.automation.id);
  await h.owner.call("automations.promote", { automationId: id, confirm: true });
  await h.owner.call("automations.set_enabled", { automationId: id, enabled: true });
  const read = await m.call("automations.get", { automationId: id });
  assert.equal(read.automation.kind, "space");
  assert.equal(read.canEdit, false, "the canvas opens it read-only for her");
  assert.equal((await h.owner.call("automations.get", { automationId: id })).canEdit, true, "the owner may change it");
  assert.ok((await m.call("automations.run", { automationId: id })).runId, "she runs it: running follows its run permission");
  await m.call("automations.make_personal_copy", { automationId: id, name: "Team intake (mine)" });
  await m.refused("automations.update", { automationId: id, name: "Renamed" }, /^permission\.role_lacks_permission$/, "a Space automation is changed by owners and admins");
  await m.refused("automations.set_enabled", { automationId: id, enabled: false }, /^permission\.role_lacks_permission$/, "nor turned off by a member");
  await m.refused("automations.delete", { automationId: id }, /^permission\./, "nor deleted (deleting takes Manage on it)");
  await h.owner.call("access.share", { resource: { type: "automation", id }, subject: { kind: "person", id: m.personId }, level: "edit", idempotencyKey: "share-edit" });
  assert.equal((await m.call("automations.get", { automationId: id })).canEdit, true, "given Edit on it, she may change it");
  await m.call("automations.update", { automationId: id, name: "Team intake, checked" });
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

test("a guest's places list only what is shared with them: the channel they were added to, never the Space's public channels, its connections or its agents", async () => {
  const open = (await h.owner.call("channels.create", { name: "general-perms", visibility: "public" })).channel.channelId as string;
  const theirs = (await h.owner.call("channels.create", { name: "client-room", visibility: "invite" })).channel.channelId as string;
  await h.owner.call("channels.members.add", { channelId: theirs, personIds: [g.personId] });
  const channels = (await g.call("channels.list", {})).channels as Array<{ channelId: string }>;
  assert.ok(channels.some((c) => c.channelId === theirs), "the guest lists the channel they were added to");
  assert.ok(!channels.some((c) => c.channelId === open), "and not a public channel they are not in");
  assert.ok(((await m.call("channels.list", {})).channels as Array<{ channelId: string }>).some((c) => c.channelId === open), "a member still lists the public channel");
  assert.deepEqual((await g.call("connections.list", {})).connections, [], "no Space connection reaches a guest");
  assert.ok(!((await g.call("agents.list", {})).agents as Array<{ agentId: string }>).some((a) => a.agentId === h.agentId), "the Space's agent is not listed unless shared");
  for (const [cap, input] of [["chat.recent", {}], ["files.tree", {}], ["files.list", { section: "space" }], ["tasks.list", { scope: "mine" }], ["tasks.count_needs_you", {}], ["settings.pages", {}], ["schema.types.list", {}], ["inbox.list_by_contact", {}], ["vault.items.list", {}], ["vault.folders.list", {}]] as const) {
    await g.call(cap, input as Record<string, unknown>);
  }
  const who = await g.call("identity.whoami");
  assert.deepEqual(who.permissions, []);
});

test("the member met no refusal the walk did not mean", () => {
  // automations.get asks access.shares_of whether she was given Edit on a Space automation; with no grant of her own there the access module refuses that inner read, which is the answer
  assert.deepEqual(unexpectedRefusals(h, [m]).filter((r) => r !== "log: access.shares_of permission.no_grant for Aina"), []);
});
