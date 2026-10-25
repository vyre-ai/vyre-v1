// The rest of the definition capabilities: create, get, list, update with versions, enable, delete and undelete, restore a version, palettes, Groups, alerts, followers, webhook URL.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, create, goodDefinition, node, NOW, MINUTE } from "../fixtures/seed.ts";
import { webhookSecretMatches } from "../impl.ts";

const names = (h: Harness): string[] => h.events.map((e) => e.name);
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const mk = async (h: Harness, over: Record<string, unknown> = {}, who = alice): Promise<string> => (await h.call("automations.create", create(over), who)).automation.id as string;
const get = async (h: Harness, id: string, who = alice): Promise<any> => (await h.call("automations.get", { automationId: id }, who)).automation;   // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- create and get ----

test("a new Automation is a Personal draft at version 1 with the owner following and the default alert", async () => {
  const h = harness();
  const r = await h.call("automations.create", create({ description: "Greets new people" }), alice);
  const a = r.automation;
  assert.equal(a.kind, "personal");
  assert.equal(a.status, "draft");
  assert.equal(a.version, 1);
  assert.equal(a.ownerId, alice.id);
  assert.equal(a.description, "Greets new people");
  assert.deepEqual(a.followers, [alice.id]);
  assert.deepEqual(a.alerts, { who: [{ kind: "person", id: alice.id }], when: { mode: "every" }, where: { needsYou: true, dm: false }, escalation: [] });
  assert.equal(a.createdAt, NOW);
  assert.deepEqual(names(h), ["automation.created"]);
  assert.deepEqual(h.events[0]!.payload, { automationId: a.id, name: "Welcome new contacts", kind: "personal" });
  assert.equal(h.events[0]!.subject, `automation/${a.id}`);
  assert.deepEqual((await h.call("automations.versions", { automationId: a.id }, alice)).versions.map((v: { n: number; reason: string }) => [v.n, v.reason]), [[1, "Created"]]);
});

test("create without a definition starts empty on the manual trigger; the default alert follows the Space setting", async () => {
  const h = harness();
  h.policy("automations.default_error_alert", { when: "after_n", n: 3, where: "dm" });
  const a = (await h.call("automations.create", { name: "Blank" }, alice)).automation;
  assert.deepEqual(a.definition, { triggers: [{ key: "manual" }], nodes: [] });
  assert.deepEqual(a.alerts.when, { mode: "after_n", n: 3 });
  assert.deepEqual(a.alerts.where, { needsYou: false, dm: true });
});

test("create refuses a blank name, a broken graph and a Group that is not there", async () => {
  const h = harness();
  await refused(h.call("automations.create", create({ name: "  " }), alice), "validation.bad_input");
  await refused(h.call("automations.create", create({ definition: { triggers: [{ key: "manual" }], nodes: [node("a", "nope", {})] } }), alice), "validation.bad_input");
  await refused(h.call("automations.create", create({ groupId: "agr_nothere" }), alice), "validation.not_found", "no_group");
});

test("an Automation is seen by its owner and followers, not by others", async () => {
  const h = harness({ authorize: (who, a) => who.id === "usr_viewer" && a.level === "view" });
  const id = await mk(h);
  assert.equal((await get(h, id)).id, id);
  await refused(h.call("automations.get", { automationId: id }, bob), "permission.not_found");
  assert.equal((await get(h, id, { id: "usr_viewer", kind: "person" } as typeof alice)).id, id);
  await h.call("automations.followers.add", { automationId: id, follower: bob.id }, alice);
  assert.equal((await get(h, id, bob)).id, id, "a follower sees it");
});

// ---- update and versions ----

test("a definition change saves a version; a name change does not; nothing changed says nothing", async () => {
  const h = harness();
  const id = await mk(h);
  const renamed = await h.call("automations.update", { automationId: id, name: "Greeting" }, alice);
  assert.equal(renamed.automation.version, 1);
  assert.deepEqual(h.events[0]!.payload, { automationId: id, version: 1, fields: ["name"] });
  await h.call("automations.update", { automationId: id, name: "Greeting" }, alice);
  assert.deepEqual(h.events, []);

  const def2 = goodDefinition({ nodes: [node("a", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "won" } })] });
  const r = await h.call("automations.update", { automationId: id, definition: def2, description: "Now sets won" }, alice);
  assert.equal(r.automation.version, 2);
  assert.deepEqual(h.events[0]!.payload, { automationId: id, version: 2, fields: ["description", "definition"] });
  const versions = (await h.call("automations.versions", { automationId: id }, alice)).versions;
  assert.deepEqual(versions.map((v: { n: number }) => v.n), [2, 1]);
  assert.equal(versions[0].by, alice.id);
  await h.call("automations.update", { automationId: id, definition: def2 }, alice);
  assert.deepEqual(h.events, [], "the same definition again is not a change");
});

test("an edit based on an old version is refused with the current one", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("automations.update", { automationId: id, definition: goodDefinition({ allowSelfTrigger: true }) }, alice);
  await assert.rejects(h.call("automations.update", { automationId: id, name: "x", expectedVersion: 1 }, alice), (e) => {
    assert.equal(codeOf(e), "validation.version_conflict");
    assert.deepEqual((e as { error: { details: unknown } }).error.details, { current: 2, expected: 1 });
    return true;
  });
  assert.equal((await h.call("automations.update", { automationId: id, name: "x", expectedVersion: 2 }, alice)).automation.name, "x");
});

test("restore saves the old definition as the newest version", async () => {
  const h = harness();
  const id = await mk(h);
  const def2 = goodDefinition({ allowSelfTrigger: true });
  await h.call("automations.update", { automationId: id, definition: def2 }, alice);
  const first = (await h.call("automations.versions", { automationId: id }, alice)).versions.find((v: { n: number }) => v.n === 1);
  const r = await h.call("automations.restore_version", { automationId: id, versionId: first.versionId }, alice);
  assert.equal(r.automation.version, 3);
  assert.deepEqual(r.automation.definition, goodDefinition());
  assert.deepEqual(names(h), ["automation.version_restored", "automation.updated"]);
  assert.equal(h.events[0]!.payload.version, 3);
  const versions = (await h.call("automations.versions", { automationId: id }, alice)).versions;
  assert.equal(versions[0].reason, "Restored version 1");
  assert.equal(versions.length, 3);
  await refused(h.call("automations.restore_version", { automationId: id, versionId: "ver_nothere" }, alice), "validation.not_found", "no_version");
});

// ---- on and off ----

test("an Automation turns on only when its definition has no errors, and says so on and off", async () => {
  const h = harness();
  const bad = await mk(h, { definition: { triggers: [{ key: "manual" }], nodes: [node("a", "records.update", { type: "contact" })] } });
  await refused(h.call("automations.set_enabled", { automationId: bad, enabled: true }, alice), "validation.precondition_failed", "invalid_definition");
  const id = await mk(h);
  const on = await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  assert.equal(on.automation.status, "on");
  assert.deepEqual(names(h), ["automation.enabled"]);
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  assert.deepEqual(h.events, [], "already on");
  const off = await h.call("automations.set_enabled", { automationId: id, enabled: false }, alice);
  assert.equal(off.automation.status, "off");
  assert.deepEqual(names(h), ["automation.disabled"]);
});

test("while it is on, a definition with errors is refused; off, it is saved as a draft of work", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  const broken = goodDefinition({ nodes: [node("a", "records.update", { type: "contact" })] });
  await refused(h.call("automations.update", { automationId: id, definition: broken }, alice), "validation.precondition_failed", "invalid_definition");
  await h.call("automations.set_enabled", { automationId: id, enabled: false }, alice);
  assert.equal((await h.call("automations.update", { automationId: id, definition: broken }, alice)).automation.version, 2);
});

// ---- delete and undelete ----

test("delete moves an Automation to Trash; undelete brings it back off", async () => {
  const h = harness();
  const id = await mk(h);
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  const d = await h.call("automations.delete", { automationId: id }, alice);
  assert.deepEqual(d, { deleted: true });
  assert.deepEqual(names(h), ["automation.deleted"]);
  await refused(h.call("automations.get", { automationId: id }, alice), "permission.not_found");
  assert.equal((await h.call("automations.list", {}, alice)).total, 0);
  const back = await h.call("automations.undelete", { automationId: id }, alice);
  assert.equal(back.automation.status, "off", "nothing fires until it is turned on again");
  assert.deepEqual(names(h), ["automation.restored"]);
  await h.call("automations.undelete", { automationId: id }, alice);
  assert.deepEqual(h.events, [], "restoring what is not in Trash does nothing");
});

// ---- list ----

test("list: sections, Group, status and search, newest first, with run counts from the runs module", async () => {
  const h = harness({ authorize: (who, a) => who.id === bob.id && a.level === "view" });
  const g = (await h.call("automations.groups.create", { name: "Intake" }, alice)).group.id as string;
  const a1 = await mk(h, { name: "Alpha" });
  h.advance(MINUTE);
  const a2 = await mk(h, { name: "Beta", groupId: g });
  h.advance(MINUTE);
  const a3 = await mk(h, { name: "Gamma" });
  await h.call("automations.set_enabled", { automationId: a3, enabled: true }, alice);
  await h.call("automations.promote", { automationId: a3, confirm: true }, alice);
  const ids = (x: { automations: { id: string }[] }): string[] => x.automations.map((a) => a.id);

  assert.deepEqual(ids(await h.call("automations.list", {}, alice)), [a3, a2, a1]);
  assert.deepEqual(ids(await h.call("automations.list", { section: "personal" }, alice)), [a2, a1]);
  assert.deepEqual(ids(await h.call("automations.list", { section: "space" }, alice)), [a3]);
  assert.deepEqual(ids(await h.call("automations.list", { section: "shared" }, bob)), [a2, a1], "Personal Automations of others that bob may view");
  assert.deepEqual(ids(await h.call("automations.list", { groupId: g }, alice)), [a2]);
  assert.deepEqual(ids(await h.call("automations.list", { status: "on" }, alice)), [a3]);
  assert.deepEqual(ids(await h.call("automations.list", { q: "alp" }, alice)), [a1]);
  const page = await h.call("automations.list", { limit: 2 }, alice);
  assert.equal(page.total, 3);
  assert.equal(page.automations.length, 2);
  assert.deepEqual(ids(await h.call("automations.list", { limit: 2, cursor: page.next }, alice)), [a1]);
  const row = (await h.call("automations.list", { q: "gamma" }, alice)).automations[0];
  assert.deepEqual(row.triggers, ["record_change"]);
  assert.equal(row.failedRuns, 0);
  assert.equal(row.lastRun, undefined);

  await h.call("automations.run", { automationId: a3 }, alice);
  h.runs[0]!.status = "failed";
  const after = (await h.call("automations.list", { q: "gamma" }, alice)).automations[0];
  assert.equal(after.failedRuns, 1);
  assert.deepEqual(after.lastRun, { runId: h.runs[0]!.id, status: "failed", at: NOW + 2 * MINUTE });
});

test("list hides Automations the caller may not see", async () => {
  const h = harness();
  await mk(h);
  assert.equal((await h.call("automations.list", {}, bob)).total, 0);
});

// ---- palettes ----

test("the trigger and step palettes come from the catalogue", async () => {
  const h = harness();
  const t = (await h.call("automations.triggers.list", {}, alice)).triggers;
  assert.ok(t.length >= 13);
  const hook = t.find((x: { key: string }) => x.key === "webhook");
  assert.equal(hook.personalOk, false);
  assert.ok(t.find((x: { key: string }) => x.key === "record_change").sample.recordId);
  const all = (await h.call("automations.steps.list", {}, alice)).steps;
  const sheets = (await h.call("automations.steps.list", { category: "sheet" }, alice)).steps;
  assert.ok(all.length > sheets.length);
  assert.ok(sheets.every((s: { category: string }) => s.category === "sheet"));
  assert.equal(all.find((s: { key: string }) => s.key === "send_email").effects, "outward");
});

// ---- Groups ----

test("Groups: create, rename, count, move in and out, delete leaves the Automations ungrouped", async () => {
  const h = harness();
  const g = (await h.call("automations.groups.create", { name: "Intake" }, alice)).group;
  assert.deepEqual({ name: g.name, count: g.count, order: g.order }, { name: "Intake", count: 0, order: 0 });
  assert.deepEqual(names(h), ["automation.group_created"]);
  const g2 = (await h.call("automations.groups.create", { name: "Billing" }, alice)).group;
  assert.equal(g2.order, 1);
  await refused(h.call("automations.groups.create", { name: "intake" }, alice), "validation.duplicate", "group_name");
  await refused(h.call("automations.groups.create", { name: " " }, alice), "validation.bad_input");
  const id = await mk(h);
  const moved = await h.call("automations.move", { automationId: id, groupId: g.id }, alice);
  assert.equal(moved.automation.groupId, g.id);
  assert.deepEqual(h.events[0]!.payload, { automationId: id, groupId: g.id });
  assert.equal((await h.call("automations.groups.list", {}, alice)).groups[0].count, 1);
  const r = await h.call("automations.groups.rename", { groupId: g.id, name: "Front desk" }, alice);
  assert.equal(r.group.name, "Front desk");
  await refused(h.call("automations.groups.rename", { groupId: g.id, name: "Billing" }, alice), "validation.duplicate");
  const out = await h.call("automations.move", { automationId: id, groupId: null }, alice);
  assert.equal(out.automation.groupId, undefined);
  assert.deepEqual(h.events[0]!.payload, { automationId: id, groupId: null });
  await h.call("automations.move", { automationId: id, groupId: g.id }, alice);
  assert.deepEqual(await h.call("automations.groups.delete", { groupId: g.id }, alice), { deleted: true });
  assert.equal((await get(h, id)).groupId, undefined);
  assert.deepEqual((await h.call("automations.groups.list", {}, alice)).groups.map((x: { name: string }) => x.name), ["Billing"]);
  await refused(h.call("automations.move", { automationId: id, groupId: g.id }, alice), "validation.not_found", "no_group");
  await refused(h.call("automations.groups.delete", { groupId: g.id }, alice), "permission.not_found");
});

// ---- alerts and followers ----

test("error alerts: who, when, where and an escalation chain that grows later", async () => {
  const h = harness();
  const id = await mk(h);
  const alerts = {
    who: [{ kind: "person", id: alice.id }], when: { mode: "after_n", n: 3 }, where: { needsYou: true, dm: true },
    escalation: [{ to: { kind: "person", id: bob.id }, afterHours: 2 }, { to: { kind: "role", id: "rol_admin" }, afterHours: 4 }],
  };
  const r = await h.call("automations.alerts.set", { automationId: id, alerts }, alice);
  assert.deepEqual(r.alerts, alerts);
  assert.deepEqual(names(h), ["automation.alerts_changed"]);
  assert.deepEqual((await h.call("automations.alerts.get", { automationId: id }, alice)).alerts, alerts);
  await refused(h.call("automations.alerts.set", { automationId: id, alerts: { ...alerts, when: { mode: "after_n" } } }, alice), "validation.bad_input", "n_required");
  await refused(h.call("automations.alerts.set", { automationId: id, alerts: { ...alerts, escalation: [alerts.escalation[1], alerts.escalation[0]] } }, alice), "validation.bad_input", "escalation_order");
});

test("followers: adding twice is one follower, removing one that is not there does nothing", async () => {
  const h = harness();
  const id = await mk(h);
  assert.deepEqual((await h.call("automations.followers.add", { automationId: id, follower: bob.id }, alice)).followers, [alice.id, bob.id]);
  assert.deepEqual(names(h), ["automation.follower_added"]);
  await h.call("automations.followers.add", { automationId: id, follower: bob.id }, alice);
  assert.deepEqual(h.events, []);
  assert.deepEqual((await h.call("automations.followers.remove", { automationId: id, follower: bob.id }, alice)).followers, [alice.id]);
  assert.deepEqual(names(h), ["automation.follower_removed"]);
  await h.call("automations.followers.remove", { automationId: id, follower: bob.id }, alice);
  assert.deepEqual(h.events, []);
});

// ---- webhook URL ----

test("the webhook URL needs a webhook trigger, stays the same until rotated, and the old one stops matching", async () => {
  const h = harness();
  const plain = await mk(h);
  await refused(h.call("automations.webhook_url.get", { automationId: plain }, alice), "validation.precondition_failed", "no_webhook_trigger");
  const id = await mk(h, { definition: { triggers: [{ key: "webhook" }], nodes: [] } });
  const a = await h.call("automations.webhook_url.get", { automationId: id }, alice);
  assert.equal(a.method, "POST");
  assert.match(a.url, new RegExp(`^https://acme\\.example\\.com/hooks/automation/${id}/[0-9a-f]{48}$`));
  assert.equal((await h.call("automations.webhook_url.get", { automationId: id }, alice)).url, a.url);
  const secret = a.url.split("/").pop() as string;
  const ctx = h.ctxFor(null, alice);
  assert.equal(webhookSecretMatches(ctx, id, secret), true);
  const rot = await h.call("automations.webhook_url.rotate", { automationId: id, confirm: true }, alice);
  assert.notEqual(rot.url, a.url);
  assert.equal(webhookSecretMatches(ctx, id, secret), false);
  assert.equal(webhookSecretMatches(ctx, id, rot.url.split("/").pop() as string), true);
  assert.equal(webhookSecretMatches(ctx, "aut_other", secret), false);
});
