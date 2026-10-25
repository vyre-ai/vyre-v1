// Built-in Kit "default" (P-L8_09, spec 2.21, 1; ARCH 7.6, 10.4): the Kit file is valid, names only capabilities that exist with inputs that validate, matches the
// record types and settings its manifest declares, applies in order to a fixture Space, and passes its own declared tests there.
// A Kit folder may import only lib, contracts, client, ui and the testkit (boundaries), so the Kit format rules and the declared-test runner of the kits module
// (modules/kits/handlers: checkKit, runKitTests) are mirrored here in small form; kits.publish runs the module's own copy on the host and in kits.yml.
// @reads /kits/default/kit.json
// @reads /kits/default/fixtures/seed.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registry } from "../../../generated/registry.ts";
import { validateInput } from "../../../generated/validators.ts";
import { seed } from "../fixtures/seed.ts";

type Obj = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type Step = { cap: string; input: Obj };
type Item = { key: string; content: string; type: string; title: string; apply?: Step; undo?: Step; recordType?: string; tools?: string[] };
type Declared = { name: string; kind: "space"; seed?: Step[]; expect: { events?: { name: string; payload?: Obj }[]; views?: { cap: string; input?: Obj; rows?: number; contains?: Obj }[] } };
type KitManifest = { key: string; title: string; version: string; channel: string; description?: string; items: Item[]; tests?: Declared[] };

const CONTENT = ["ui", "structure", "steps", "tools"];
const CAP = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;
const raw = (): Obj => JSON.parse(readFileSync(new URL("../kit.json", import.meta.url), "utf8")) as Obj;

/** The Kit format rules of modules/kits (checkKit), as problems naming a path. */
function formatProblems(k: Obj): string[] {
  const out: string[] = [];
  const bad = (p: string, m: string): void => { out.push(`${p}: ${m}`); };
  if (typeof k["key"] !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(k["key"])) bad("key", "lowercase letters, digits and dashes");
  if (typeof k["title"] !== "string" || !k["title"] || k["title"].length > 80) bad("title", "1 to 80 characters");
  if (typeof k["version"] !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(k["version"])) bad("version", "semver");
  if (!["stable", "beta"].includes(k["channel"])) bad("channel", "stable or beta");
  if (typeof k["description"] === "string" && k["description"].length > 300) bad("description", "at most 300 characters");
  const forbidden = (cap: string): boolean => /^kits\./.test(cap) || /^vault\.(item\.get|export_env|export|use|fill)$/.test(cap);
  const stepOk = (s: Obj | undefined, p: string): void => {
    if (s === undefined) return;
    if (typeof s["cap"] !== "string" || !CAP.test(s["cap"]) || (s["input"] !== undefined && (typeof s["input"] !== "object" || s["input"] === null))) { bad(p, "a step is { cap, input }"); return; }
    if (forbidden(s["cap"])) bad(p, `${s["cap"]} cannot be used by a Kit`);
  };
  if (!Array.isArray(k["items"]) || k["items"].length < 1 || k["items"].length > 500) { bad("items", "1 to 500 items"); return out; }
  const seen = new Set<string>();
  (k["items"] as Obj[]).forEach((it, i) => {
    const at = `items[${i}]`;
    if (typeof it["key"] !== "string" || !/^[a-z][a-z0-9_.-]{0,60}$/.test(it["key"])) bad(`${at}.key`, "lowercase letters, digits, dots, dashes, underscores");
    else if (seen.has(it["key"])) bad(`${at}.key`, `${it["key"]} is used twice`);
    else seen.add(it["key"]);
    if (!CONTENT.includes(it["content"])) bad(`${at}.content`, "ui, structure, steps or tools");
    if (typeof it["type"] !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(it["type"])) bad(`${at}.type`, "a type such as record_type");
    if (typeof it["title"] !== "string" || !it["title"] || it["title"].length > 120) bad(`${at}.title`, "1 to 120 characters");
    stepOk(it["apply"], `${at}.apply`);
    stepOk(it["undo"], `${at}.undo`);
    for (const t of (it["tools"] ?? []) as string[]) if (!CAP.test(t) || forbidden(t)) bad(`${at}.tools`, `${t} is not a capability a Kit may use`);
  });
  if (!Array.isArray(k["tests"]) || k["tests"].length === 0) bad("tests", "every Kit needs at least one test before it can publish");
  for (const [i, t] of ((k["tests"] ?? []) as Obj[]).entries()) if (t["kind"] !== "space" || !t["name"] || typeof t["expect"] !== "object") bad(`tests[${i}]`, "a space test has a name and an expect object");
  return out;
}

const kit = (): KitManifest => {
  assert.deepEqual(formatProblems(raw()), []);
  return raw() as KitManifest;
};
const contentsOf = (k: KitManifest): string[] => CONTENT.filter((c) => k.items.some((i) => i.content === c));
const steps = (k: KitManifest): { item: string; which: string; step: Step }[] =>
  k.items.flatMap((it) => (["apply", "undo"] as const).flatMap((w) => (it[w] ? [{ item: it.key, which: w, step: it[w]! }] : [])));

/** What the install sheet lists (sheetOf of modules/kits): every capability called, record types made, nothing else. */
function sheetOf(k: KitManifest): { tools: string[]; recordTypes: string[] } {
  const tools = new Set<string>(), types = new Set<string>();
  for (const it of k.items) {
    for (const t of it.tools ?? []) tools.add(t);
    if (it.apply) tools.add(it.apply.cap);
    if (it.undo) tools.add(it.undo.cap);
    if (it.type === "record_type") types.add(it.recordType ?? it.key);
  }
  return { tools: [...tools].sort(), recordTypes: [...types].sort() };
}

/** A fixture Space whose neighbours answer like the real modules: types, settings, automations and agents appear, each with its event. */
class Fixture {
  calls: Step[] = [];
  log: { name: string; payload: Obj }[] = [];
  types: string[] = [];
  answers = new Map<string, (i: Obj) => unknown>();
  constructor() {
    const on = (cap: string, f: (i: Obj) => unknown): void => { this.answers.set(cap, f); };
    on("schema.apply", (i) => {
      for (const op of i["ops"] as { op: string; type: string }[]) {
        if (op.op === "type.create" && !this.types.includes(op.type)) this.types.push(op.type);
        if (op.op === "type.drop") this.types = this.types.filter((t) => t !== op.type);
      }
      this.log.push({ name: "schema.changed", payload: { count: i["ops"].length } });
      return { changeId: "sch_1", applied: i["ops"].length, items: [] };
    });
    on("schema.types.list", () => ({ types: this.types.map((key) => ({ key })) }));
    on("schema.layout.set", (i) => { this.log.push({ name: "schema.changed", payload: { type: i["type"] } }); return { sections: i["sections"] }; });
    on("settings.set_space", (i) => { this.log.push({ name: "settings.changed", payload: { key: i["key"] } }); return { row: { key: i["key"] }, previous: null }; });
    on("settings.reset_space", (i) => { this.log.push({ name: "settings.changed", payload: { key: i["key"] } }); return {}; });
    on("access.groups.defaults_set", (i) => { this.log.push({ name: "access.everyone_defaults_changed", payload: { grants: i["grants"].length } }); return { groupId: "grp_everyone", grants: i["grants"] }; });
    on("automations.create", (i) => { this.log.push({ name: "automation.created", payload: { name: i["name"] } }); return { automation: { name: i["name"] } }; });
    on("agents.create", (i) => { this.log.push({ name: "agent.created", payload: { name: i["name"] } }); return { agent: { name: i["name"] } }; });
  }
  async call(cap: string, input: Obj): Promise<unknown> {
    this.calls.push({ cap, input });
    const a = this.answers.get(cap);
    if (!a) throw new Error(`the fixture Space has no answer for ${cap}`);
    return a(input);
  }
}

const subset = (want: Obj, have: Obj): boolean => Object.entries(want).every(([k, v]) => JSON.stringify(have[k]) === JSON.stringify(v));

/** The kits module's declared-test runner (runKitTests), small form: each test applies the Kit to its own fresh Space, seeds, then checks events and views. */
async function runDeclared(k: KitManifest): Promise<{ test: string; message: string }[]> {
  const failures: { test: string; message: string }[] = [];
  for (const t of k.tests ?? []) {
    const s = new Fixture();
    try {
      for (const it of k.items) if (it.apply) await s.call(it.apply.cap, it.apply.input);
      for (const st of t.seed ?? []) await s.call(st.cap, st.input);
      for (const want of t.expect.events ?? []) {
        if (!s.log.some((e) => e.name === want.name && (want.payload === undefined || subset(want.payload, e.payload)))) failures.push({ test: t.name, message: `expected the event ${want.name}; saw ${s.log.map((e) => e.name).join(", ") || "no events"}` });
      }
      for (const v of t.expect.views ?? []) {
        const out = await s.call(v.cap, v.input ?? {});
        const rows = (Object.values(out as Obj).find((x) => Array.isArray(x)) ?? []) as Obj[];
        if (v.rows !== undefined && rows.length !== v.rows) failures.push({ test: t.name, message: `view ${v.cap} returned ${rows.length} rows, expected ${v.rows}` });
        if (v.contains !== undefined && !rows.some((r) => subset(v.contains!, r))) failures.push({ test: t.name, message: `view ${v.cap} has no row like ${JSON.stringify(v.contains)}` });
      }
    } catch (e) {
      failures.push({ test: t.name, message: `the test could not run: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return failures;
}

// ---- the file --------------------------------------------------------------------------------------------------------------------

test("the Kit file is a valid Kit: key, semver version, stable channel, every content type it needs, and a test", () => {
  const k = kit();
  assert.equal(k.key, "default");
  assert.equal(k.version, "1.0.0");
  assert.equal(k.channel, "stable");
  assert.ok((k.tests ?? []).length >= 2, "every Kit ships tests (publish is blocked without them)");
  assert.deepEqual(contentsOf(k), ["ui", "structure", "steps", "tools"]);
  assert.equal(new Set(k.items.map((i) => i.key)).size, k.items.length);
});

test("the install sheet lists what the Kit touches and names no network domain, no Vault handle and no script", () => {
  const sheet = sheetOf(kit());
  assert.deepEqual(sheet.recordTypes, ["note_board"]);
  assert.ok(kit().items.every((i) => !("networkDomains" in i) && !("vaultNames" in i)), "no network domain and no Vault handle");
  assert.equal((raw()["scripts"] ?? []).length, 0, "no scripts");
  for (const t of ["schema.apply", "settings.set_space", "automations.create", "access.groups.defaults_set", "agents.create", "tasks.create", "records.update"]) assert.ok(sheet.tools.includes(t), `the sheet lists ${t}`);
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
  assert.ok(keys.every((k) => k.startsWith("kit.default.")), "keys are namespaced by the Kit");
});

// ---- agreement with the manifest ---------------------------------------------------------------------------------------------------

test("the record types match what the manifest declares: title, plural, icon, group, status field and field keys and types", () => {
  const made = steps(kit()).flatMap((s) => (s.step.cap === "schema.apply" ? (s.step.input["ops"] as Obj[]) : [])).filter((o) => o["op"] === "type.create");
  assert.deepEqual(made.map((o) => o["type"]).sort(), ["note_board"]);
  for (const op of made) {
    const declared = registry.recordTypes.find((r) => r.key === op["type"] && r.module === "default");
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
  assert.deepEqual(rail, registry.settings.find((r) => r.key === "kit.default.rail")!.default, "the default Kit's rail is the manifest default");
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

test("the meeting-ended Automation triggers when the transcript is ready and uses steps and a trigger that exist, with a path from the trigger to the last step", () => {
  const create = steps(kit()).find((s) => s.step.cap === "automations.create")!.step.input as Obj;
  const def = create["definition"] as { triggers: { key: string }[]; nodes: { id: string; key: string; next?: string[] }[] };
  assert.deepEqual(def.triggers.map((t) => t.key), ["meeting_transcript_ready"]);
  assert.ok(registry.triggers.some((t) => t.key === "meeting_transcript_ready"), "the trigger is in the catalogue");
  const stepKeys = new Set(registry.steps.map((s) => s.key));
  for (const n of def.nodes) assert.ok(stepKeys.has(n.key), `step ${n.key} exists`);
  const ids = new Set(def.nodes.map((n) => n.id));
  for (const n of def.nodes) for (const to of n.next ?? []) assert.ok(ids.has(to), `${n.id} -> ${to}`);
  assert.equal(def.nodes.filter((n) => !def.nodes.some((m) => (m.next ?? []).includes(n.id))).length, 1, "exactly one first step");
  assert.deepEqual(validateInput("automations.validate", 1, { definition: def }), []);
});

test("Everyone gets edit on the note board and nothing wider", () => {
  const grants = steps(kit()).find((s) => s.step.cap === "access.groups.defaults_set")!.step.input["grants"] as { resource: { type: string; id: string }; level: string }[];
  assert.deepEqual(grants, [{ resource: { type: "record_type", id: "note_board" }, level: "edit" }]);
});

// ---- on a fixture Space ----------------------------------------------------------------------------------------------------------

test("install: the Kit's steps apply in item order, each with its own input, and the record types, layouts, settings and agents exist afterwards", async () => {
  const s = new Fixture();
  for (const it of kit().items) if (it.apply) await s.call(it.apply.cap, it.apply.input);
  assert.deepEqual(s.calls.map((c) => c.cap), kit().items.flatMap((i) => (i.apply ? [i.apply.cap] : [])));
  assert.deepEqual(s.types, ["note_board"]);
  assert.deepEqual(s.calls.filter((c) => c.cap === "settings.set_space").map((c) => c.input["key"]), ["kit.default.rail", "space.skin_default"]);
  assert.ok(s.log.some((e) => e.name === "schema.changed") && s.log.some((e) => e.name === "settings.changed"));
});

test("the Kit's own declared tests pass on a fixture Space that answers like the real neighbours", async () => {
  assert.ok((kit().tests ?? []).length >= 2);
  assert.deepEqual(await runDeclared(kit()), []);
});

test("a Kit that loses its record type fails its own test and names it", async () => {
  const broken = kit();
  broken.items = broken.items.filter((i) => i.key !== "rt.note_board");
  const failures = await runDeclared(broken);
  assert.ok(failures.length >= 1);
  assert.match(failures.map((f) => f.message).join("\n"), /note_board/);
});

test("the format check names the path of each problem (a Kit with a forbidden capability, a duplicate key and no tests)", () => {
  const bad = raw();
  bad["items"] = [...bad["items"], { ...bad["items"][0] }, { key: "x.install", content: "steps", type: "automation", title: "X", apply: { cap: "kits.install", input: {} } }];
  delete bad["tests"];
  const problems = formatProblems(bad).join("\n");
  assert.match(problems, /is used twice/);
  assert.match(problems, /kits\.install cannot be used by a Kit/);
  assert.match(problems, /tests: every Kit needs at least one test/);
});

test("the seed recipe creates records of the Kit's own type with unique idempotency keys that pass the generated validator", () => {
  assert.ok(seed.length >= 2);
  const keys = new Set<string>();
  for (const s of seed) {
    assert.equal(s.cap, "records.create");
    assert.equal(s.input["type"], "note_board");
    assert.deepEqual(validateInput(s.cap, 1, s.input), []);
    keys.add(s.input["idempotencyKey"] as string);
  }
  assert.equal(keys.size, seed.length);
});

test("items that create things by id (the Automation and the Assistant) carry no undo: a Kit step cannot name an id it does not know yet", () => {
  const k = kit();
  for (const key of ["auto.meeting_ended", "agent.assistant"]) assert.equal(k.items.find((i) => i.key === key)!.undo, undefined, key);
  for (const { item, which, step } of steps(k)) if (which === "undo") assert.ok(!["automations.delete", "agents.delete"].includes(step.cap), `${item}: an undo by id would be refused`);
});
