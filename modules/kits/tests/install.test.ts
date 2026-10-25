// kits core: the Kit format, the install sheet, install, update and one-click rollback, previews, versions, choosing and the builder chat (spec 2.21; ARCH 7.6).
// Real SQLite behind the host's table guard, generated validators on every input, output and event.
// The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/kits/migrations/0001_kits.sql

import test from "node:test";
import assert from "node:assert/strict";
import { checkKit, compareSemver, configureKits, sheetOf } from "../handlers/index.ts";
import { admin, codeOf, harness, kitManifest, refused } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const v2 = (): Obj => kitManifest({
  version: "1.1.0",
  items: [
    { key: "rt.matter", content: "structure", type: "record_type", title: "Matter", recordType: "matter", apply: { cap: "schema.apply", input: { changes: [{ op: "create_type", name: "matter" }, { op: "add_field", name: "status" }] } }, undo: { cap: "schema.apply", input: { changes: [{ op: "drop_type", name: "matter" }], confirm: ["matter"] } } },
    { key: "ui.words", content: "ui", type: "words", title: "Law firm words" },
    { key: "agent.clerk", content: "tools", type: "agent", title: "Intake clerk", tools: ["records.create", "mail.send"] },
    { key: "conn.stripe", content: "tools", type: "connector", title: "Stripe", networkDomains: ["api.stripe.com"], vaultNames: ["#Stripe_Key"] },
    { key: "form.intake", content: "structure", type: "form", title: "Intake form", apply: { cap: "forms.create", input: { name: "Intake" } }, undo: { cap: "forms.delete", input: { name: "Intake" } } },
  ],
});

async function installed(h: Harness): Promise<string> {
  const kitId = await h.shipped();
  await h.call("kits.install", { kitId, accepted: true });
  return kitId;
}

// ---- the format -----------------------------------------------------------------------------------------------

test("compareSemver: major, minor, patch, and prereleases before their release", () => {
  const lt = [["1.0.0", "1.0.1"], ["1.9.0", "1.10.0"], ["0.9.9", "1.0.0"], ["1.0.0-beta.1", "1.0.0"], ["1.0.0-beta.2", "1.0.0-beta.11"], ["1.0.0-alpha", "1.0.0-alpha.1"], ["1.0.0-1", "1.0.0-alpha"]];
  for (const [a, b] of lt) { assert.equal(compareSemver(a!, b!), -1, `${a} < ${b}`); assert.equal(compareSemver(b!, a!), 1, `${b} > ${a}`); }
  assert.equal(compareSemver("2.0.0", "2.0.0"), 0);
  assert.throws(() => compareSemver("2", "2.0.0"), TypeError);
});

test("checkKit: a valid manifest comes back whole with the channel defaulted, and every problem is named with its path", () => {
  const ok = checkKit(kitManifest({ channel: undefined }));
  assert.equal(ok.kit?.channel, "stable");
  assert.equal(ok.kit?.items.length, 5);
  assert.deepEqual(ok.kit?.scripts?.[0], { name: "fee", source: "return { fee: input.hours * 250 };", caps: [] });
  const bad = (over: Obj): string => checkKit(kitManifest(over)).problems.join("\n");
  assert.match(checkKit(null).problems.join(), /an object/);
  assert.match(bad({ key: "Law Intake" }), /key: lowercase/);
  assert.match(bad({ version: "1.0" }), /version: a semver/);
  assert.match(bad({ channel: "nightly" }), /channel: stable or beta/);
  assert.match(bad({ items: [] }), /items: 1 to 500/);
  const item = (x: Obj): Obj => ({ key: "a", content: "ui", type: "words", title: "A", ...x });
  assert.match(bad({ items: [item({}), item({})] }), /items\[1\]\.key: a is used twice/);
  assert.match(bad({ items: [item({ content: "magic" })] }), /content: ui, structure, steps or tools/);
  assert.match(bad({ items: [item({ apply: { cap: "kits.install", input: {} } })] }), /kits\.install cannot be used by a Kit/);
  assert.match(bad({ items: [item({ apply: { cap: "vault.export_env", input: {} } })] }), /vault\.export_env cannot be used/);
  assert.match(bad({ items: [item({ tools: ["vault.item.get"] })] }), /tools: a list of capability names/);
  assert.match(bad({ items: [item({ networkDomains: ["http://evil.example"] })] }), /networkDomains: a list of host names/);
  assert.match(bad({ items: [item({ vaultNames: ["Stripe_Key"] })] }), /vaultNames: a list of Vault handles/);
  assert.match(bad({ items: [item({ apply: { cap: "NotACap", input: {} } })] }), /apply: a step is/);
  assert.match(bad({ scripts: [{ name: "a", source: "return 1" }, { name: "a", source: "return 2" }] }), /scripts\[1\]: a is used twice/);
  assert.match(bad({ scripts: [{ name: "a", source: "return 1", caps: ["kits.update"] }] }), /caps: a list of capability names/);
  assert.match(bad({ tests: [{ name: "t", kind: "script", script: "nope", expect: {} }] }), /script: names a script of this Kit/);
  assert.match(bad({ tests: [{ name: "t", kind: "other", expect: {} }] }), /kind: script or space/);
  assert.match(bad({ tests: [{ name: "t", kind: "space", seed: [{ cap: "kits.publish" }], expect: {} }] }), /seed\[0\]/);
});

test("sheetOf: every capability the Kit calls, record type, domain, Vault name and the script count, sorted", () => {
  const kit = checkKit(kitManifest()).kit!;
  assert.deepEqual(sheetOf(kit), {
    tools: ["automations.create", "automations.delete", "mail.send", "records.create", "schema.apply"],
    recordTypes: ["matter"], networkDomains: ["api.stripe.com"], vaultNames: ["#Stripe_Key"], scripts: 1, problems: [],
  });
  const withScriptCaps = checkKit(kitManifest({ scripts: [{ name: "s", source: "return 1", caps: ["records.query", "records.create"] }] })).kit!;
  assert.deepEqual(sheetOf(withScriptCaps).tools, ["automations.create", "automations.delete", "mail.send", "records.create", "records.query", "schema.apply"]);
});

// ---- the catalog, the sheet, install ------------------------------------------------------------------------

test("list and get: shipped Kits appear once, not installed, with their content types; a Kit that fails its own check is skipped with a warning", async () => {
  const h = harness();
  h.source.builtins = [kitManifest(), kitManifest({ key: "estate-planning", title: "Estate planning" }), { key: "Broken" }];
  const out = await h.call("kits.list", {});
  assert.deepEqual(out.kits.map((k: Obj) => [k.key, k.version, k.channel, k.installed, k.contents]), [
    ["estate-planning", "1.0.0", "stable", false, ["ui", "structure", "steps", "tools"]], ["law-intake", "1.0.0", "stable", false, ["ui", "structure", "steps", "tools"]],
  ]);
  assert.equal(out.total, 2);
  assert.ok(h.warnings.some((w) => w.includes("shipped Kit is not valid")));
  await h.call("kits.list", {});
  assert.equal(h.rows("kits_kit").length, 2, "listing again adds nothing");
  assert.equal(h.rows("kits_version").length, 2);
  const page = await h.call("kits.list", { limit: 1 });
  assert.equal(page.kits.length, 1);
  assert.equal(page.next, "1");
  assert.deepEqual((await h.call("kits.get", { kitId: out.kits[1].kitId })).kit.key, "law-intake");
  await refused(h.call("kits.get", { kitId: "kit_gone" }), "validation.not_found");
});

test("install sheet lists everything the Kit adds, and install needs the sheet confirmed", async () => {
  const h = harness();
  const kitId = await h.shipped();
  const { problems, ...listed } = (await h.call("kits.install_sheet", { kitId })).sheet;
  assert.deepEqual(listed, {
    tools: ["automations.create", "automations.delete", "mail.send", "records.create", "schema.apply"],
    recordTypes: ["matter"], networkDomains: ["api.stripe.com"], vaultNames: ["#Stripe_Key"], scripts: 1,
  });
  // the fixture's steps are sketches (they do not fit the real contracts), so the sheet check names them before anyone installs
  assert.ok(problems.length > 0 && problems.every((p: Obj) => typeof p.item === "string" && ["apply", "undo"].includes(p.step) && typeof p.cap === "string" && typeof p.message === "string"));
  await refused(h.call("kits.install", { kitId, accepted: false }, admin, false), "validation.bad_input");
  await refused(h.call("kits.install", { kitId }, admin, false), "validation.bad_input");
  assert.equal(h.callsTo("schema.apply").length, 0, "nothing ran before the sheet was accepted");
});

test("install: apply steps run in order as the installer, the ledger and the event are written, a second install is refused", async () => {
  const h = harness();
  const kitId = await h.shipped();
  const out = await h.call("kits.install", { kitId, accepted: true });
  assert.deepEqual([out.kit.installed, out.kit.version], [true, "1.0.0"]);
  assert.deepEqual(h.calls.filter((c) => c.cap !== "settings.kit.set_space").map((c) => c.cap), ["schema.apply", "automations.create"]);
  assert.deepEqual(h.callsTo("schema.apply")[0]!.input.changes, [{ op: "create_type", name: "matter" }]);
  const ledger = h.rows("kits_applied");
  assert.deepEqual(ledger.map((r) => r.item_key).sort(), ["agent.clerk", "auto.new-matter", "conn.stripe", "rt.matter", "ui.words"]);
  assert.equal(ledger.filter((r) => r.undo !== null).length, 2);
  const kitRow = h.rows("kits_kit")[0]!;
  assert.deepEqual([kitRow.installed_version, kitRow.previous_version, kitRow.installed_by], ["1.0.0", null, admin.id]);
  assert.deepEqual(h.events.map((e) => [e.name, e.subject, e.payload]), [["kit.installed", `kit/${kitId}`, { kitId, version: "1.0.0" }]]);
  await refused(h.call("kits.install", { kitId, accepted: true }), "validation.precondition_failed");
  assert.deepEqual((await h.call("kits.install_sheet", { kitId })).sheet.recordTypes, ["matter"]);
});

test("install: a step that fails undoes what this install added, names the item, and leaves the Kit not installed", async () => {
  const h = harness();
  const kitId = await h.shipped();
  h.callee("automations.create", () => { throw Object.assign(new Error("denied"), { error: { code: "permission.denied", message: "You cannot create automations." } }); });
  await assert.rejects(h.call("kits.install", { kitId, accepted: true }), (e: unknown) => {
    assert.equal(codeOf(e), "validation.precondition_failed");
    assert.match((e as { error: { message: string } }).error.message, /Could not install "Open a matter on new lead": You cannot create automations\. Nothing was left half installed\./);
    return true;
  });
  assert.deepEqual(h.callsTo("schema.apply").map((c) => c.input.changes[0].op), ["create_type", "drop_type"], "the type it added was dropped again");
  assert.equal(h.rows("kits_applied").length, 0);
  assert.equal(h.rows("kits_kit")[0]!.installed_version, null);
  assert.equal(h.events.length, 0);
  // fixed, the same install works
  h.callee("automations.create", () => ({ automation: {} }));
  assert.equal((await h.call("kits.install", { kitId, accepted: true })).kit.installed, true);
});

test("install: a Kit with no published version cannot be installed; the preview of an uninstalled Kit lists every item as an add", async () => {
  const h = harness();
  const kitId = await h.shipped();
  const preview = await h.call("kits.preview", { kitId });
  assert.deepEqual(preview.changes.map((c: Obj) => [c.kind, c.title]), [
    ["record_type", "Add Matter"], ["automation", "Add Open a matter on new lead"], ["words", "Add Law firm words"], ["agent", "Add Intake clerk"], ["connector", "Add Stripe"],
  ]);
  h.source.builtins = [];
  h.sqlite.exec("DELETE FROM kits_head");
  await refused(h.call("kits.install", { kitId, accepted: true }), "validation.precondition_failed");
  await refused(h.call("kits.preview", { kitId }), "validation.precondition_failed");
});

// ---- update, rollback, preview -------------------------------------------------------------------------------

test("update: added and changed items run their apply step, removed items run their undo, the ledger and the versions follow", async () => {
  const h = harness();
  const kitId = await installed(h);
  await refused(h.call("kits.update", { kitId }), "validation.precondition_failed");
  h.advance(1000);
  await h.ship(v2());
  h.calls.length = 0;
  const preview = await h.call("kits.preview", { kitId });
  assert.deepEqual(preview.changes.map((c: Obj) => [c.kind, c.title]), [["record_type", "Change Matter"], ["form", "Add Intake form"], ["automation", "Remove Open a matter on new lead"]]);
  h.callee("forms.create", () => ({ form: {} }));
  h.callee("forms.delete", () => ({ deleted: true }));
  const out = await h.call("kits.update", { kitId });
  assert.deepEqual([out.kit.version, out.kit.installed], ["1.1.0", true]);
  assert.deepEqual(h.calls.map((c) => c.cap), ["schema.apply", "forms.create", "automations.delete"]);
  assert.deepEqual(h.callsTo("schema.apply")[0]!.input.changes[1], { op: "add_field", name: "status" });
  assert.deepEqual(h.rows("kits_applied").map((r) => r.item_key).sort(), ["agent.clerk", "conn.stripe", "form.intake", "rt.matter", "ui.words"]);
  const k = h.rows("kits_kit")[0]!;
  assert.deepEqual([k.installed_version, k.previous_version], ["1.1.0", "1.0.0"]);
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["kit.updated", { kitId, from: "1.0.0", to: "1.1.0" }]]);
  // nothing newer: refused; an unknown or older version too
  await refused(h.call("kits.update", { kitId }), "validation.precondition_failed");
  await refused(h.call("kits.update", { kitId, version: "9.9.9" }), "validation.not_found");
  await refused(h.call("kits.update", { kitId, version: "1.0.0" }), "validation.precondition_failed");
  await refused(h.call("kits.update", { kitId: await h.shipped(kitManifest({ key: "other", title: "Other" })) }), "validation.precondition_failed");
});

test("rollback restores the earlier version in one call: changed items are re-applied, removed ones come back, added ones are undone", async () => {
  const h = harness();
  const kitId = await installed(h);
  const before = h.rows("kits_applied").map((r) => [r.item_key, r.item_hash]).sort();
  h.advance(1000);
  await h.ship(v2());
  h.callee("forms.create", () => ({ form: {} }));
  h.callee("forms.delete", () => ({ deleted: true }));
  await h.call("kits.update", { kitId });
  h.calls.length = 0;

  const out = await h.call("kits.rollback", { kitId });
  assert.deepEqual([out.kit.version, out.kit.installed], ["1.0.0", true]);
  assert.deepEqual(h.calls.map((c) => c.cap), ["schema.apply", "automations.create", "forms.delete"]);
  assert.deepEqual(h.callsTo("schema.apply")[0]!.input.changes, [{ op: "create_type", name: "matter" }], "the earlier version's step ran again");
  assert.deepEqual(h.rows("kits_applied").map((r) => [r.item_key, r.item_hash]).sort(), before, "the ledger is what the first install left");
  const k = h.rows("kits_kit")[0]!;
  assert.deepEqual([k.installed_version, k.previous_version], ["1.0.0", "1.1.0"]);
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["kit.rolled_back", { kitId, to: "1.0.0" }]]);
  await refused(h.call("kits.rollback", { kitId, toVersion: "1.0.0" }), "validation.precondition_failed");
  await refused(h.call("kits.rollback", { kitId, toVersion: "0.1.0" }), "validation.not_found");
  // and forward again by naming the version
  assert.equal((await h.call("kits.rollback", { kitId, toVersion: "1.1.0" })).kit.version, "1.1.0");
});

test("rollback: nothing to go back to, and a Kit that is not installed", async () => {
  const h = harness();
  const kitId = await h.shipped();
  await refused(h.call("kits.rollback", { kitId }), "validation.precondition_failed");
  await h.call("kits.install", { kitId, accepted: true });
  await refused(h.call("kits.rollback", { kitId }), "validation.precondition_failed");
  await refused(h.call("kits.update", { kitId: "kit_gone" }), "validation.not_found");
});

test("update that fails halfway keeps the ledger as it was, so a retry re-applies", async () => {
  const h = harness();
  const kitId = await installed(h);
  h.advance(1000);
  await h.ship(v2());
  h.callee("forms.create", () => { throw new Error("forms are down"); });
  await refused(h.call("kits.update", { kitId }), "validation.precondition_failed");
  assert.equal(h.rows("kits_kit")[0]!.installed_version, "1.0.0");
  assert.deepEqual(h.rows("kits_applied").map((r) => r.item_key).sort(), ["agent.clerk", "auto.new-matter", "conn.stripe", "rt.matter", "ui.words"]);
  assert.equal(h.events.length, 0);
  h.callee("forms.create", () => ({ form: {} }));
  h.callee("forms.delete", () => ({ deleted: true }));
  assert.equal((await h.call("kits.update", { kitId })).kit.version, "1.1.0");
});

// ---- versions, choice, builder ------------------------------------------------------------------------------

test("versions list newest first; restore_version moves the channel head back", async () => {
  const h = harness();
  const kitId = await h.shipped();
  h.advance(1000);
  await h.ship(v2());
  const list = await h.call("kits.versions", { kitId });
  assert.deepEqual(list.versions.map((v: Obj) => [v.version, v.channel, v.by]), [["1.1.0", "stable", "builtin"], ["1.0.0", "stable", "builtin"]]);
  assert.match(list.versions[0].versionId, /^ver_[a-z0-9]+$/);
  const head = () => h.rows("kits_head")[0]!.version_id;
  assert.equal(head(), list.versions[0].versionId);
  const out = await h.call("kits.restore_version", { kitId, versionId: list.versions[1].versionId });
  assert.equal(head(), list.versions[1].versionId);
  assert.equal(out.kit.version, "1.0.0", "an uninstalled Kit shows its head");
  await refused(h.call("kits.restore_version", { kitId, versionId: "ver_gone" }), "validation.not_found");
  // a restored head is not undone by listing the catalog again
  await h.call("kits.list", {});
  assert.equal(head(), list.versions[1].versionId);
});

test("choose: only an installed Kit, for the Space or for the person, through the settings module", async () => {
  const h = harness();
  const kitId = await h.shipped();
  await refused(h.call("kits.choose", { kitId, scope: "space" }), "validation.precondition_failed");
  await h.call("kits.install", { kitId, accepted: true });
  assert.deepEqual(await h.call("kits.choose", { kitId, scope: "space" }), { ok: true });
  assert.deepEqual(await h.call("kits.choose", { kitId, scope: "person" }), { ok: true });
  assert.deepEqual(h.callsTo("settings.kit.set_space").map((c) => c.input), [{ kitId }]);
  assert.deepEqual(h.callsTo("settings.kit.set_mine").map((c) => c.input), [{ kitId }]);
  await refused(h.call("kits.choose", { kitId, scope: "team" }, admin, false), "validation.bad_input");
});

test("builder_open: opens a chat with the builder agent about the Kit; no agent means a clear refusal", async () => {
  const h = harness();
  const kitId = await h.shipped();
  const out = await h.call("kits.builder_open", { kitId, brief: "Add a retainer form", idempotencyKey: "k1" });
  assert.deepEqual(out, { threadId: "thr_builder1" });
  assert.deepEqual(h.callsTo("chat.start")[0]!.input, { kind: "chat", agentIds: ["agt_builder"], title: "Kit builder: Law firm intake", scopeType: "kit", scopeId: kitId, first: "Add a retainer form" });
  await h.call("kits.builder_open", { idempotencyKey: "k2" });
  assert.deepEqual(h.callsTo("chat.start")[1]!.input, { kind: "chat", agentIds: ["agt_builder"], title: "Kit builder" });
  const none = harness({ builder: null });
  await refused(none.call("kits.builder_open", { idempotencyKey: "k3" }), "validation.precondition_failed");
  configureKits(null);
});


// ---- the sheet check (P-CC_31) ----

const goodType = (type: string): Obj => ({
  key: `rt.${type}`, content: "structure", type: "record_type", title: type, recordType: type,
  apply: { cap: "schema.apply", input: { ops: [{ op: "type.create", type, def: { title: type, plural: `${type}s`, icon: "note", titleField: "title", fields: [{ key: "title", type: "text", title: "Title", required: true }] } }], idempotencyKey: `kit.${type}`, reason: "Kit install" } },
});

test("sheet check: a sound Kit has no problems; a broken step is named with its item, step, capability, input and why", async () => {
  const h = harness();
  const ok = await h.shipped(kitManifest({ key: "sound", items: [goodType("matter")] }));
  assert.deepEqual((await h.call("kits.install_sheet", { kitId: ok })).sheet.problems, []);
  const broken = kitManifest({
    key: "broken",
    items: [
      goodType("lead"),
      { key: "x.nocap", content: "steps", type: "automation", title: "No such tool", apply: { cap: "automations.teleport", input: {} } },
      { key: "x.badinput", content: "steps", type: "automation", title: "Bad input", apply: { cap: "schema.apply", input: { changes: [{ op: "create_type" }] } }, undo: { cap: "schema.apply", input: { ops: "no" } } },
      goodType("lead"),
    ].map((it, i) => (i === 3 ? { ...it, key: "rt.lead2" } : it)),
  });
  const kitId = await h.shipped(broken);
  const { problems } = (await h.call("kits.install_sheet", { kitId })).sheet as { problems: Obj[] };
  const by = (item: string, step: string): Obj | undefined => problems.find((p) => p.item === item && p.step === step);
  assert.match(by("x.nocap", "apply")!.message, /automations\.teleport is not a capability/);
  assert.equal(by("x.nocap", "apply")!.cap, "automations.teleport");
  assert.match(by("x.badinput", "apply")!.message, /does not fit schema\.apply/);
  assert.deepEqual(by("x.badinput", "apply")!.input, { changes: [{ op: "create_type" }] });
  assert.match(by("x.badinput", "undo")!.message, /does not fit schema\.apply/);
  assert.match(by("rt.lead2", "apply")!.message, /Record type lead is created twice/);
  assert.equal(by("rt.lead", "apply"), undefined, "the first of two is fine");
});

test("sheet check: a record type the Space already has is a problem before install, not a failure during it", async () => {
  const h = harness();
  h.callee("schema.types.get", (i: { type: string }) => (i.type === "note_board" ? { type: { type: "note_board" } } : (() => { throw new Error("not found"); })()));
  const kitId = await h.shipped(kitManifest({ key: "boards", items: [goodType("note_board"), goodType("commission")] }));
  const { problems } = (await h.call("kits.install_sheet", { kitId })).sheet as { problems: Obj[] };
  assert.deepEqual(problems.map((p) => [p.item, p.step, p.message]), [["rt.note_board", "apply", "Record type note_board already exists in this Space."]]);
});
// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.
// rerun on the final commit
