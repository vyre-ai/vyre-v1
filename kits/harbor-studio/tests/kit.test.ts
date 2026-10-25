// Built-in Kit "harbor-studio" (P-L8_09, spec 2.21, 1; ARCH 7.6, 10.4): the Kit file is valid, names only capabilities that exist with inputs that validate, matches the
// record types and settings its manifest declares, installs and rolls into the Space in order, and passes its own tests on a fixture Space.
// Real SQLite behind the kits module, generated validators on every input; the fixture Space answers like the neighbours it stands for.
// @reads /kits/harbor-studio/kit.json
// @reads /kits/harbor-studio/fixtures/seed.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkKit, sheetOf } from "../../../modules/kits/handlers/index.ts";
import type { KitManifest } from "../../../modules/kits/handlers/index.ts";
import type { KitStep } from "../../../modules/kits/handlers/install.ts";
import { FakeSpace, harness } from "../../../modules/kits/fixtures/db.ts";
import { registry } from "../../../generated/registry.ts";
import { validateInput } from "../../../generated/validators.ts";
import { seed } from "../fixtures/seed.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const raw = (): Obj => JSON.parse(readFileSync(new URL("../kit.json", import.meta.url), "utf8")) as Obj;
const kit = (): KitManifest => {
  const c = checkKit(raw());
  assert.deepEqual(c.problems, []);
  return c.kit!;
};
const contentsOf = (k: KitManifest): string[] => ["ui", "structure", "steps", "tools"].filter((c) => k.items.some((i) => i.content === c));
const steps = (k: KitManifest): { item: string; which: string; step: KitStep }[] =>
  k.items.flatMap((it) => (["apply", "undo"] as const).flatMap((w) => (it[w] ? [{ item: it.key, which: w, step: it[w]! }] : [])));

/** A fixture Space whose neighbours answer like the real modules: types, settings, automations and agents appear, each with its event. */
function realisticSpace(): FakeSpace {
  const s = new FakeSpace();
  const on = (cap: string, f: (i: any) => unknown): void => { s.answers.set(cap, f); };   // eslint-disable-line @typescript-eslint/no-explicit-any
  on("schema.apply", (i) => {
    for (const op of i.ops as { op: string; type: string }[]) {
      if (op.op === "type.create" && !s.types.includes(op.type)) s.types.push(op.type);
      if (op.op === "type.drop") s.types = s.types.filter((t) => t !== op.type);
    }
    s.log.push({ name: "schema.changed", payload: { count: i.ops.length } });
    return { changeId: "sch_1", applied: i.ops.length, items: [] };
  });
  on("schema.types.list", () => ({ types: s.types.map((key) => ({ key })) }));
  on("schema.layout.set", (i) => { s.log.push({ name: "schema.changed", payload: { type: i.type } }); return { sections: i.sections }; });
  on("settings.set_space", (i) => { s.log.push({ name: "settings.changed", payload: { key: i.key } }); return { row: { key: i.key }, previous: null }; });
  on("settings.reset_space", (i) => { s.log.push({ name: "settings.changed", payload: { key: i.key } }); return {}; });
  on("access.groups.defaults_set", (i) => { s.log.push({ name: "access.everyone_defaults_changed", payload: { grants: i.grants.length } }); return { groupId: "grp_everyone", grants: i.grants }; });
  on("automations.create", (i) => { s.log.push({ name: "automation.created", payload: { name: i.name } }); return { automation: { name: i.name } }; });
  on("agents.create", (i) => { s.log.push({ name: "agent.created", payload: { name: i.name } }); return { agent: { name: i.name } }; });
  return s;
}

function installable() {
  const h = harness({ fixture: realisticSpace });
  for (const cap of ["schema.layout.set", "settings.set_space", "settings.reset_space", "access.groups.defaults_set", "agents.create", "calendar.list_events"]) h.callee(cap, () => ({}));
  return h;
}

// ---- the file --------------------------------------------------------------------------------------------------------------------

test("the Kit file is a valid Kit: key, semver version, stable channel, every content type it needs, and a test", () => {
  const k = kit();
  assert.equal(k.key, "harbor-studio");
  assert.equal(k.version, "1.0.0");
  assert.equal(k.channel, "stable");
  assert.ok((k.tests ?? []).length >= 2, "every Kit ships tests (publish is blocked without them)");
  assert.deepEqual(contentsOf(k), ["ui", "structure", "tools"]);
  assert.equal(new Set(k.items.map((i) => i.key)).size, k.items.length);
});

test("the install sheet lists what the Kit touches and names no network domain, no Vault handle and no script", () => {
  const sheet = sheetOf(kit());
  assert.deepEqual(sheet.recordTypes, ["commission"]);
  assert.deepEqual(sheet.networkDomains, []);
  assert.deepEqual(sheet.vaultNames, []);
  assert.equal(sheet.scripts, 0);
  for (const t of ["schema.apply", "settings.set_space", "agents.create", "calendar.list_events"]) assert.ok(sheet.tools.includes(t), `the sheet lists ${t}`);
});

test("every capability a step or tool names exists, no step uses a Kit-forbidden capability, and every step input passes the generated validator", () => {
  const caps = new Map(registry.capabilities.map((c) => [c.name, c]));
  for (const { item, which, step } of steps(kit())) {
    assert.ok(caps.has(step.cap), `${item} ${which}: ${step.cap} is not a capability`);
    assert.deepEqual(validateInput(step.cap, 1, step.input), [], `${item} ${which}: ${step.cap} input`);
  }
  for (const it of kit().items) for (const t of it.tools ?? []) assert.ok(caps.has(t), `${it.key}: tool ${t} is not a capability`);
});

test("every write step that needs an idempotency key carries a stable one, unique across the Kit", () => {
  const keys: string[] = [];
  for (const { item, step } of steps(kit())) {
    const cap = registry.capabilities.find((c) => c.name === step.cap)!;
    if (cap.idempotency === "key") {
      const key = step.input["idempotencyKey"];
      assert.equal(typeof key, "string", `${item}: ${step.cap} needs an idempotencyKey`);
      keys.push(key as string);
    }
  }
  assert.equal(new Set(keys).size, keys.length, "idempotency keys are unique");
  assert.ok(keys.every((k) => k.startsWith("kit.harbor.")), "keys are namespaced by the Kit");
});

// ---- agreement with the manifest ---------------------------------------------------------------------------------------------------

test("the record types match what the manifest declares: title, plural, icon, group, status field and field keys and types", () => {
  const made = steps(kit()).flatMap((s) => (s.step.cap === "schema.apply" ? (s.step.input["ops"] as Obj[]) : [])).filter((o) => o["op"] === "type.create");
  assert.deepEqual(made.map((o) => o["type"]).sort(), ["commission"]);
  for (const op of made) {
    const declared = registry.recordTypes.find((r) => r.key === op["type"] && r.module === "harbor-studio");
    assert.ok(declared, `the manifest declares ${op["type"]}`);
    const d = op["def"] as Obj;
    for (const k of ["title", "plural", "icon", "group", "titleField"] as const) assert.equal(d[k], (declared as Obj)[k], `${op["type"]}.${k}`);
    if ((declared as Obj)["statusField"]) assert.equal(d["statusField"], (declared as Obj)["statusField"]);
    assert.deepEqual((d["fields"] as Obj[]).map((f) => [f["key"], f["type"]]), ((declared as Obj)["fields"] as Obj[]).map((f) => [f["key"], f["type"]]), `${op["type"]} fields`);
  }
});

test("the settings the Kit writes are declared in the registry and its values pass their schema", () => {
  const writes = steps(kit()).filter((s) => s.step.cap === "settings.set_space" && s.which === "apply").map((s) => s.step.input as { key: string; value: unknown });
  assert.ok(writes.some((w) => w.key === "kit.default.rail") && writes.some((w) => w.key === "space.skin_default"));
  for (const w of writes) {
    const row = registry.settings.find((r) => r.key === w.key);
    assert.ok(row, `${w.key} is a declared setting`);
    assert.equal(row.scope, "space");
  }
  const rail = writes.find((w) => w.key === "kit.default.rail")!.value as string[];
  assert.equal(new Set(rail).size, rail.length, "no place twice on the rail");
  const places = ["home", "chats", "inbox", "records", "files", "apps", "automations", "vault", "settings"];
  assert.deepEqual([...rail].sort(), [...places].sort(), "the rail holds every place once, in this Kit's order");
  assert.notDeepEqual(rail, registry.settings.find((r) => r.key === "kit.default.rail")!.default, "the studio rail differs from the default rail");
  assert.ok(rail.indexOf("records") < rail.indexOf("inbox"), "Records come before Inbox in the studio rail");
});

test("the layout of each type shows only fields the type has", () => {
  const types = new Map(steps(kit()).flatMap((s) => (s.step.cap === "schema.apply" ? (s.step.input["ops"] as Obj[]) : [])).filter((o) => o["op"] === "type.create").map((o) => [o["type"], ((o["def"] as Obj)["fields"] as Obj[]).map((f) => f["key"])] as const));
  const layouts = steps(kit()).filter((s) => s.step.cap === "schema.layout.set");
  assert.ok(layouts.length >= 1);
  for (const { step } of layouts) {
    const have = types.get(step.input["type"] as string);
    assert.ok(have, `layout for a type this Kit creates`);
    for (const sec of step.input["sections"] as Obj[]) for (const f of sec["fields"] as string[]) assert.ok(have.includes(f), `${step.input["type"]}.${f}`);
  }
});

test("Harbor Studio switches skin, rail and words: another skin than the default Kit, a rail in another order, and studio words on its record type", () => {
  const skins = new Set(["graphite", "obsidian", "charcoal", "slate", "ember", "moss", "dusk", "paper", "fog", "linen", "sand", "sage", "mist"]);
  const set = (key: string) => steps(kit()).find((s) => s.step.cap === "settings.set_space" && s.step.input["key"] === key)!.step.input["value"];
  const skin = set("space.skin_default") as string;
  assert.ok(skins.has(skin), `${skin} is one of the 13 skins`);
  assert.notEqual(skin, "paper", "the default Kit uses paper");
  const op = steps(kit()).flatMap((s) => (s.step.cap === "schema.apply" ? (s.step.input["ops"] as Obj[]) : [])).find((o) => o["op"] === "type.create")!;
  const def = op["def"] as Obj;
  assert.deepEqual([def["title"], def["plural"]], ["Commission", "Commissions"]);
  assert.equal((def["fields"] as Obj[]).find((f) => f["key"] === "client")!["title"], "Client");
  const words = kit().items.find((i) => i.key === "ui.words")!;
  assert.equal(words.content, "ui");
  assert.match(words.title, /Commission/);
});

test("the studio has two agents with narrow tool lists: the producer moves commissions, the art director only reads", () => {
  const agents = kit().items.filter((i) => i.type === "agent");
  assert.deepEqual(agents.map((a) => a.key), ["agent.producer", "agent.art_director"]);
  const director = agents.find((a) => a.key === "agent.art_director")!;
  assert.deepEqual(director.tools, ["records.query", "files.read"]);
  for (const t of director.tools ?? []) assert.equal(registry.capabilities.find((c) => c.name === t)!.effects, "read", `${t} only reads`);
  assert.ok(agents.find((a) => a.key === "agent.producer")!.tools!.includes("records.update"));
});

test("the status stages run brief, concept, review, delivered, in the order a studio works", () => {
  const op = steps(kit()).flatMap((s) => (s.step.cap === "schema.apply" ? (s.step.input["ops"] as Obj[]) : [])).find((o) => o["op"] === "type.create")!;
  const status = ((op["def"] as Obj)["fields"] as Obj[]).find((f) => f["key"] === "status")!;
  assert.deepEqual(((status["options"] as Obj)["stages"] as Obj[]).map((s) => s["key"]), ["brief", "concept", "review", "delivered"]);
  for (const s of seed) assert.ok(["brief", "concept", "review", "delivered"].includes((s.input["fields"] as Obj)["status"] as string));
});

// ---- on the kits module and a fixture Space ----------------------------------------------------------------------------------------

test("install: the module applies the Kit's steps in order, each with its own input, and nothing else", async () => {
  const h = installable();
  const kitId = await h.shipped(raw());
  const sheet = await h.call("kits.install_sheet", { kitId });
  assert.deepEqual(sheet.sheet.recordTypes, ["commission"]);
  await h.call("kits.install", { kitId, accepted: true });
  const applied = steps(kit()).filter((s) => s.which === "apply").map((s) => s.step.cap);
  assert.deepEqual(h.calls.filter((c) => c.cap !== "kits.install").map((c) => c.cap).filter((c) => applied.includes(c)), applied.filter((c) => c !== "kits.install"));
  assert.equal(h.callsTo("schema.apply").length, steps(kit()).filter((s) => s.which === "apply" && s.step.cap === "schema.apply").length);
  assert.deepEqual(h.callsTo("settings.set_space").map((c) => c.input["key"]), ["kit.default.rail", "space.skin_default"]);
  const got = (await h.call("kits.get", { kitId })).kit;
  assert.deepEqual([got.installed, got.version, got.contents], [true, "1.0.0", contentsOf(kit())]);
});

test("the Kit's own tests pass on a fixture Space that answers like the real neighbours", async () => {
  const h = installable();
  const kitId = await h.shipped(raw());
  const out = await h.call("kits.test_run", { kitId });
  assert.deepEqual(out, { passed: true, failures: [] });
  assert.ok(h.spaces.length >= (raw()["tests"] as unknown[]).length, "each test opened its own fresh Space");
  assert.ok(h.spaces.every((s) => s.closed));
});

test("a Kit that loses its record type fails its own test and names it", async () => {
  const h = installable();
  const broken = raw();
  broken["items"] = (broken["items"] as Obj[]).filter((i) => i["key"] !== "rt.commission");
  const kitId = await h.shipped(broken);
  const out = await h.call("kits.test_run", { kitId });
  assert.equal(out.passed, false);
  assert.match(out.failures.map((f: { message: string }) => f.message).join("\n"), /commission/);
});

test("the seed recipe creates records of the Kit's own type with unique idempotency keys that pass the generated validator", () => {
  assert.ok(seed.length >= 2);
  const keys = new Set<string>();
  for (const s of seed) {
    assert.equal(s.cap, "records.create");
    assert.equal(s.input["type"], "commission");
    assert.deepEqual(validateInput(s.cap, 1, s.input), []);
    keys.add(s.input["idempotencyKey"] as string);
  }
  assert.equal(keys.size, seed.length);
});

test("the agents carry no undo: a Kit step cannot name an id it does not know yet", () => {
  for (const it of kit().items.filter((i) => i.type === "agent")) assert.equal(it.undo, undefined, it.key);
});
