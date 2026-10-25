// templates (spec 2.21, 3.6; ARCH 7.6): the gallery lists one-item Kits, preview shows what a template adds without writing anything, install is kits.install, and a saved item is a template too.
// The kits module, schema and automations are scripted neighbours that record every call (fixtures/db.ts).
// @reads /modules/templates/migrations/0001_templates.sql

import test from "node:test";
import assert from "node:assert/strict";
import { admin, harness, kit, refused } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

const MATTER = kit("matter-type", "Matter", [{ type: "record_type", title: "Matter", recordType: "matter" }]);
const INTAKE = kit("intake-automation", "Intake follow-up", [{ type: "automation", title: "Follow up on new intake" }]);
const STRIPE = kit("stripe-form", "Payment form", [{ type: "form", title: "Payment form", networkDomains: ["api.stripe.com"], vaultNames: ["#Stripe_Key"] }]);
const PLAN = kit("case-project", "Case project", [{ type: "project", title: "Case project" }]);
const STAGES = kit("onboarding-journey", "Client onboarding", [{ type: "journey", title: "Client onboarding" }]);
const BIG = kit("law-intake", "Law firm intake", [{ type: "record_type", title: "Matter", recordType: "matter" }, { type: "automation", title: "Open a matter" }]);
const WORDS = kit("words", "Law words", [{ type: "words", title: "Law firm words" }]);

/** Every test gets its own copy of the Kits, so one test installing a Kit never leaks into the next. */
function rig(...kits: ReturnType<typeof kit>[]): Harness {
  const h = harness();
  h.kits.push(...kits.map((k) => structuredClone(k)));
  return h;
}

let keySeq = 0;
/** templates.save is a create, so every call carries its own idempotency key. */
const save = (h: Harness, input: Record<string, unknown>, who = admin, check = true) => h.call("templates.save", { idempotencyKey: `save-${++keySeq}`, ...input }, who, check);

const K = (h: Harness, key: string) => h.kits.find((k) => k.key === key)!;

const templatesRows = (h: Harness) => h.rows("templates_template");

// ---- list ---------------------------------------------------------------------------------------------------

test("list: a Kit that adds exactly one item of a template kind is a template; bigger Kits and other item types are not", async () => {
  const h = rig(MATTER, INTAKE, STRIPE, PLAN, STAGES, BIG, WORDS);
  const out = await h.call("templates.list", {});
  assert.equal(out.total, 5);
  assert.deepEqual(out.templates.map((t: { title: string; kind: string }) => [t.title, t.kind]), [
    ["Case project", "project"], ["Client onboarding", "journey"], ["Intake follow-up", "automation"], ["Matter", "record_type"], ["Payment form", "form"],
  ]);
  const matter = out.templates.find((t: { title: string }) => t.title === "Matter");
  assert.deepEqual({ ...matter, templateId: "x" }, { templateId: "x", title: "Matter", kind: "record_type", summary: "Adds Matter.", version: "1.0.0", adds: ["Matter"] });
  assert.match(matter.templateId, /^tpl_[a-z0-9]+$/);
});

test("list: filtering by kind, paging with a cursor, and a bad cursor, limit or kind", async () => {
  const h = rig(MATTER, INTAKE, STRIPE, PLAN, STAGES);
  assert.deepEqual((await h.call("templates.list", { kind: "form" })).templates.map((t: { title: string }) => t.title), ["Payment form"]);
  assert.deepEqual((await h.call("templates.list", { kind: "site" })).templates, []);
  const first = await h.call("templates.list", { limit: 2 });
  assert.equal(first.templates.length, 2);
  assert.equal(first.next, "2");
  assert.equal(first.total, 5);
  const second = await h.call("templates.list", { limit: 2, cursor: first.next });
  assert.deepEqual(second.templates.map((t: { title: string }) => t.title), ["Intake follow-up", "Matter"]);
  const last = await h.call("templates.list", { limit: 2, cursor: second.next });
  assert.equal(last.templates.length, 1);
  assert.equal(last.next, undefined);
  await refused(h.call("templates.list", { cursor: "-1" }), "validation.bad_input");
  await refused(h.call("templates.list", { cursor: "abc" }), "validation.bad_input");
  await refused(h.call("templates.list", { limit: 0 }, admin, false), "validation.bad_input");
  await refused(h.call("templates.list", { kind: "spreadsheet" }, admin, false), "validation.bad_input");
});

test("list: a Kit already seen at the same version is not previewed again; a new version is; a Kit that grows past one item leaves the gallery; a removed Kit is gone", async () => {
  const h = rig(MATTER, INTAKE);
  await h.call("templates.list", {});
  assert.equal(h.callsTo("kits.preview").length, 2);
  await h.call("templates.list", {});
  assert.equal(h.callsTo("kits.preview").length, 2, "nothing new to ask");

  K(h, "matter-type").version = "1.1.0";
  const again = await h.call("templates.list", {});
  assert.equal(h.callsTo("kits.preview").length, 3, "only the Kit with a new version is previewed");
  assert.equal(again.templates.find((t: { title: string }) => t.title === "Matter").version, "1.1.0");

  K(h, "matter-type").version = "2.0.0";
  K(h, "matter-type").items.push({ type: "automation", title: "Open a matter" });
  assert.deepEqual((await h.call("templates.list", {})).templates.map((t: { title: string }) => t.title), ["Intake follow-up"]);
  K(h, "matter-type").items.pop();
  K(h, "matter-type").version = "1.0.0";

  h.kits.splice(h.kits.indexOf(K(h, "intake-automation")), 1);
  assert.deepEqual((await h.call("templates.list", {})).templates.map((t: { title: string }) => t.title), ["Matter"]);
});

test("list: an installed Kit keeps its row (it has nothing left to add) and follows its version; a Kit whose preview fails is skipped with a warning", async () => {
  const h = rig(MATTER, INTAKE);
  await h.call("templates.list", {});
  K(h, "matter-type").installed = true;
  K(h, "matter-type").version = "1.2.0";
  const out = await h.call("templates.list", {});
  const m = out.templates.find((t: { title: string }) => t.title === "Matter");
  assert.equal(m.version, "1.2.0");
  assert.deepEqual(m.adds, ["Matter"]);
  K(h, "matter-type").installed = false;
  K(h, "matter-type").version = "1.0.0";

  const broken = rig(PLAN);
  broken.callee("kits.preview", () => { throw new Error("the kits module is busy"); });
  assert.deepEqual((await broken.call("templates.list", {})).templates, []);
  assert.ok(broken.warnings.some((w) => w.includes("could not preview a Kit")));
});

test("list: pages through more Kits than one kits.list page", async () => {
  const many = Array.from({ length: 130 }, (_, i) => kit(`rt-${i}`, `Type ${String(i).padStart(3, "0")}`, [{ type: "record_type", title: `T${i}` }]));
  const h = rig(...many);
  const out = await h.call("templates.list", { limit: 500 });
  assert.equal(out.total, 130);
  assert.equal(h.callsTo("kits.list").length, 2, "two pages of 100 and 30");
  assert.equal(h.callsTo("kits.list")[1]!.input.cursor, "100");
});

// ---- preview ------------------------------------------------------------------------------------------------

test("preview: shows what the template adds, the record types, network domains and Vault names, and writes nothing", async () => {
  const h = rig(MATTER, STRIPE);
  const listed = await h.call("templates.list", {});
  const stripe = listed.templates.find((t: { kind: string }) => t.kind === "form");
  const matter = listed.templates.find((t: { kind: string }) => t.kind === "record_type");
  const before = JSON.stringify(templatesRows(h));
  h.calls.length = 0;

  const s = await h.call("templates.preview", { templateId: stripe.templateId });
  assert.deepEqual({ ...s.template, templateId: "x" }, { templateId: "x", title: "Payment form", kind: "form", summary: "Adds Payment form.", version: "1.0.0", adds: ["Payment form"] });
  assert.deepEqual(s.record_types, []);
  assert.deepEqual(s.domains, ["api.stripe.com"]);
  assert.deepEqual(s.vaultNames, ["#Stripe_Key"]);
  const m = await h.call("templates.preview", { templateId: matter.templateId });
  assert.deepEqual(m.record_types, ["matter"]);
  assert.deepEqual(m.template.adds, ["Matter"]);

  assert.deepEqual([...new Set(h.calls.map((c) => c.cap))].sort(), ["kits.install_sheet", "kits.preview"], "preview reads the sheet and the preview, nothing else");
  assert.equal(h.callsTo("kits.install").length, 0);
  assert.equal(h.events.length, 0, "no event");
  assert.equal(JSON.stringify(templatesRows(h)), before, "no row changed");
  assert.equal(K(h, "matter-type").installed, false);
});

test("preview: an installed template adds nothing more, so its cached list stays; an unknown id and the empty starter", async () => {
  const h = rig(MATTER);
  const id = (await h.call("templates.list", {})).templates[0].templateId;
  K(h, "matter-type").installed = true;
  assert.deepEqual((await h.call("templates.preview", { templateId: id })).template.adds, ["Matter"]);
  await refused(h.call("templates.preview", { templateId: "tpl_doesnotexist" }), "validation.not_found");
  await refused(h.call("templates.preview", {}, admin, false), "validation.bad_input");
  const empty = await h.call("templates.preview", { templateId: "tpl_emptyproject" });
  assert.deepEqual([empty.template.title, empty.template.adds, empty.record_types, empty.domains, empty.vaultNames], ["Empty project", [], [], [], []]);
});

// ---- install ------------------------------------------------------------------------------------------------

test("install: hands the install to kits.install with the sheet accepted, emits template.installed once, and names what was installed", async () => {
  const h = rig(MATTER, INTAKE);
  const matter = (await h.call("templates.list", {})).templates.find((t: { kind: string }) => t.kind === "record_type");
  h.calls.length = 0;
  const out = await h.call("templates.install", { templateId: matter.templateId });
  assert.deepEqual(out, { installed: [{ kind: "record_type", id: K(h, "matter-type").kitId }] });
  assert.deepEqual(h.calls.map((c) => [c.cap, c.input]), [["kits.install", { kitId: K(h, "matter-type").kitId, accepted: true }]]);
  assert.deepEqual(h.events.map((e) => [e.name, e.subject, e.payload]), [["template.installed", `entity/${matter.templateId}`, { templateId: matter.templateId, kind: "record_type" }]]);
  assert.equal(K(h, "matter-type").installed, true);
  assert.equal(K(h, "intake-automation").installed, false);
});

test("install: a Kit that is already installed, an unknown template, a folder for a Kit template and the empty starter are refused and no event fires", async () => {
  const h = rig(MATTER);
  const id = (await h.call("templates.list", {})).templates[0].templateId;
  await h.call("templates.install", { templateId: id });
  await refused(h.call("templates.install", { templateId: id }), "validation.precondition_failed");
  assert.equal(h.events.length, 0);
  await refused(h.call("templates.install", { templateId: "tpl_doesnotexist" }), "validation.not_found");
  K(h, "matter-type").installed = false;
  await refused(h.call("templates.install", { templateId: id, into: "fld_x" }), "validation.bad_input");
  assert.equal(K(h, "matter-type").installed, false, "nothing was installed");
  await refused(h.call("templates.install", { templateId: "tpl_emptyjourney" }), "validation.precondition_failed");
  await refused(h.call("templates.install", {}, admin, false), "validation.bad_input");
});

test("install: when the kits module refuses (permission, Gate, a failing step), the error reaches the caller unchanged and nothing is recorded", async () => {
  const h = rig(MATTER);
  const id = (await h.call("templates.list", {})).templates[0].templateId;
  h.callee("kits.install", () => { throw Object.assign(new Error("denied"), { error: { code: "permission.role_lacks_permission", message: "Needs kits.install." } }); });
  await refused(h.call("templates.install", { templateId: id }), "permission.role_lacks_permission");
  assert.equal(h.events.length, 0);
});

// ---- save and install a saved template ----------------------------------------------------------------------

const CONTACT_TYPE = {
  key: "client", title: "Client", plural: "Clients", icon: "users", label: "internal", system: false, titleField: "name", group: "People", version: 3,
  fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "email", type: "email", title: "Email" }],
};
const AUTOMATION = { id: "aut_abc1", name: "Welcome new client", description: "Sends the welcome.", definition: { triggers: [{ event: "record.created" }], nodes: [] }, version: 2 };

test("save: a record type becomes a one-item template in Kit format; it lists, previews its record type and installs through schema.apply with the stored definition", async () => {
  const h = rig(MATTER);
  h.callee("schema.types.get", () => ({ type: CONTACT_TYPE }));
  const saved = await save(h, { kind: "record_type", ref: "client", title: "Client record" });
  assert.deepEqual({ ...saved.template, templateId: "x" }, { templateId: "x", title: "Client record", kind: "record_type", summary: "Adds Client record.", version: "1.0.0", adds: ["Client record"] });
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["template.saved", { templateId: saved.template.templateId, kind: "record_type" }]]);
  const row = h.rows("templates_template").find((r) => r.id === saved.template.templateId)!;
  assert.equal(row.source, "saved");
  assert.equal(row.created_by, "usr_admin");
  const manifest = JSON.parse(String(row.manifest));
  assert.equal(manifest.items.length, 1, "a template is exactly one item");
  assert.equal(manifest.items[0].type, "record_type");
  assert.equal("syncedFrom" in manifest.items[0].apply.input.ops[0].def, false);
  assert.equal("system" in manifest.items[0].apply.input.ops[0].def, false);

  const listed = await h.call("templates.list", {});
  assert.ok(listed.templates.some((t: { templateId: string }) => t.templateId === saved.template.templateId), "the gallery shows it");
  await h.call("templates.list", {});
  assert.ok(h.rows("templates_template").some((r) => r.id === saved.template.templateId), "a gallery sync keeps saved templates");

  const p = await h.call("templates.preview", { templateId: saved.template.templateId });
  assert.deepEqual(p.record_types, ["client"]);
  h.calls.length = 0;
  const done = await h.call("templates.install", { templateId: saved.template.templateId });
  assert.deepEqual(done, { installed: [{ kind: "record_type", id: "client" }] });
  assert.deepEqual(h.calls.map((c) => c.cap), ["schema.apply"]);
  const op = h.callsTo("schema.apply")[0]!.input;
  assert.deepEqual(op.ops, [{ op: "type.create", type: "client", def: { title: "Client", plural: "Clients", icon: "users", label: "internal", titleField: "name", group: "People", fields: CONTACT_TYPE.fields } }]);
  assert.equal(op.idempotencyKey, `tpl.${saved.template.templateId}`, "installing the same template twice is one install");
  assert.deepEqual(h.events.map((e) => e.name), ["template.installed"]);
});

test("save: an Automation is saved with its definition and installs through automations.create, into a folder when one is given", async () => {
  const h = rig();
  h.callee("automations.get", () => ({ automation: AUTOMATION }));
  const saved = await save(h, { kind: "automation", ref: "aut_abc1", title: "Welcome" });
  h.calls.length = 0;
  const done = await h.call("templates.install", { templateId: saved.template.templateId, into: "fld_automations" });
  assert.deepEqual(done, { installed: [{ kind: "automation", id: "aut_new1" }] });
  const input = h.callsTo("automations.create")[0]!.input;
  assert.equal(input.name, "Welcome new client");
  assert.equal(input.description, "Sends the welcome.");
  assert.deepEqual(input.definition, AUTOMATION.definition);
  assert.equal(input.folderId, "fld_automations");
  const plain = await h.call("templates.install", { templateId: saved.template.templateId });
  assert.deepEqual(plain, { installed: [{ kind: "automation", id: "aut_new1" }] });
  assert.equal(h.callsTo("automations.create")[1]!.input.folderId, undefined);
  // a record type has no folder
  h.callee("schema.types.get", () => ({ type: CONTACT_TYPE }));
  const rt = await save(h, { kind: "record_type", ref: "client", title: "Client" });
  await refused(h.call("templates.install", { templateId: rt.template.templateId, into: "fld_x" }), "validation.bad_input");
});

test("save: a system or synced record type, a missing item, kinds that cannot be saved yet, a blank title and a bad kind are refused and nothing is stored or emitted", async () => {
  const h = rig();
  h.callee("schema.types.get", (i: { type: string }) => (i.type === "task" ? { type: { ...CONTACT_TYPE, key: "task", system: true } } : i.type === "hubspot_deal" ? { type: { ...CONTACT_TYPE, key: "hubspot_deal", syncedFrom: "hubspot" } } : i.type === "site_tbl" ? { type: { ...CONTACT_TYPE, scope: "sit_abc" } } : {}));
  h.callee("automations.get", () => ({}));
  await refused(save(h, { kind: "record_type", ref: "task", title: "Task" }), "validation.precondition_failed");
  await refused(save(h, { kind: "record_type", ref: "hubspot_deal", title: "Deal" }), "validation.precondition_failed");
  await refused(save(h, { kind: "record_type", ref: "site_tbl", title: "Leads" }), "validation.precondition_failed");
  await refused(save(h, { kind: "record_type", ref: "nothing", title: "Nothing" }), "validation.not_found");
  await refused(save(h, { kind: "automation", ref: "aut_none", title: "None" }), "validation.not_found");
  for (const kind of ["agent", "journey", "runbook", "project"]) await refused(save(h, { kind, ref: "x1", title: "X" }), "validation.precondition_failed");
  await refused(save(h, { kind: "record_type", ref: "client", title: "   " }, admin, false), "validation.bad_input");
  await refused(save(h, { kind: "record_type", ref: "client", title: "x".repeat(121) }, admin, false), "validation.bad_input");
  await refused(save(h, { kind: "spreadsheet", ref: "x", title: "X" }, admin, false), "validation.bad_input");
  assert.equal(h.rows("templates_template").length, 0);
  assert.equal(h.events.length, 0);
});

test("install: a saved template whose step fails says so, names the item and emits nothing", async () => {
  const h = rig();
  h.callee("schema.types.get", () => ({ type: CONTACT_TYPE }));
  const saved = await save(h, { kind: "record_type", ref: "client", title: "Client" });
  h.callee("schema.apply", () => { throw Object.assign(new Error("exists"), { error: { code: "validation.bad_input", message: "The type client already exists." } }); });
  await refused(h.call("templates.install", { templateId: saved.template.templateId }), "validation.precondition_failed");
  assert.equal(h.events.length, 0);
  assert.ok(h.warnings.some((w) => w.includes("install failed")));
});

// ---- project and Journey starters ---------------------------------------------------------------------------

test("project_starters: an empty starter first, then the templates of that kind", async () => {
  const h = rig(PLAN, STAGES, MATTER);
  const projects = await h.call("templates.project_starters", { kind: "project" });
  assert.deepEqual(projects.starters.map((s: { title: string }) => s.title), ["Empty project", "Case project"]);
  assert.equal(projects.starters[0].templateId, "tpl_emptyproject");
  assert.deepEqual(projects.starters[0].adds, []);
  const journeys = await h.call("templates.project_starters", { kind: "journey" });
  assert.deepEqual(journeys.starters.map((s: { title: string }) => s.title), ["Empty Journey", "Client onboarding"]);
  await refused(h.call("templates.project_starters", { kind: "site" }, admin, false), "validation.bad_input");
  await refused(h.call("templates.project_starters", {}, admin, false), "validation.bad_input");
  assert.equal(h.events.length, 0);
});

test("project_starters: with no Kits at all there is still the empty starter", async () => {
  const h = rig();
  assert.deepEqual((await h.call("templates.project_starters", { kind: "project" })).starters.map((s: { title: string }) => s.title), ["Empty project"]);
});
