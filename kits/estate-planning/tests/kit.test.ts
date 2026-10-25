// Built-in Kit "estate-planning" (P-L8_10, spec 2.21, 1; ARCH 7.6, 10.4): estate-planning structure with a sealed Tax ID.
// The Kit file is valid, names only capabilities that exist with inputs that validate, matches the record types and settings its manifest declares, applies in order
// to a fixture Space, and passes its own declared tests there.
// A Kit folder may import only lib, contracts, client, ui and the testkit (boundaries), so the Kit format rules and the declared-test runner of the kits module
// (modules/kits/handlers: checkKit, runKitTests) are mirrored here in small form; kits.publish runs the module's own copy on the host and in kits.yml.
// The industry Kit installs structure in one click (spec 2.21).
// @reads /kits/estate-planning/kit.json
// @reads /kits/estate-planning/fixtures/seed.ts

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
  journeys: { name: string; subjectType: string }[] = [];
  forms: { name: string; recordType: string }[] = [];
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
    on("journeys.create", (i) => { this.journeys.push({ name: i["name"], subjectType: i["subjectType"] }); this.log.push({ name: "journey.created", payload: { name: i["name"] } }); return { journey: { name: i["name"] } }; });
    on("forms.create", (i) => { this.forms.push({ name: i["name"], recordType: i["recordType"] }); return { form: { name: i["name"] } }; });
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


const KEY = "estate-planning";
const TYPES = ["client_plan"];
const STAGED_TYPE = "client_plan";
const STAGE_KEYS = ["intake", "drafting", "review", "signing", "funding", "complete"];
const JOURNEY_ITEM = "journey.estate_plan";
const JOURNEY_STAGES = ["intake", "drafting", "review", "signing", "funding", "complete"];
const FORM_ITEM = "form.questionnaire";
const FORM_KIND = "one_use";
const AUTO_ITEM = "auto.questionnaire_in";
const AGENT_ITEM = "agent.drafting_assistant";
const SHEET_TOOLS = ["schema.apply", "schema.layout.set", "journeys.create", "forms.create", "automations.create", "tasks.create", "records.update", "agents.create", "records.query", "files.read", "esign.send"];

/** The schema accepts field keys in lower snake case only (its field key pattern, which the layout input repeats); the manifests that name these types write some keys in camel case. */
const snake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const typeOps = (): Obj[] => steps(kit()).flatMap((s) => (s.step.cap === "schema.apply" ? (s.step.input["ops"] as Obj[]) : [])).filter((o) => o["op"] === "type.create");
const item = (key: string): Item => kit().items.find((i) => i.key === key)!;
const stepInput = (key: string): Obj => item(key).apply!.input;

// ---- the file --------------------------------------------------------------------------------------------------------------------

test("the Kit file is a valid Kit: key, semver version, stable channel, every content type, two tests", () => {
  const k = kit();
  assert.equal(k.key, KEY);
  assert.equal(k.version, "1.0.0");
  assert.equal(k.channel, "stable");
  assert.ok((k.tests ?? []).length >= 2, "every Kit ships tests (publish is blocked without them)");
  assert.deepEqual(contentsOf(k), ["ui", "structure", "steps", "tools"]);
  assert.equal(new Set(k.items.map((i) => i.key)).size, k.items.length);
});

test("the install sheet lists what the Kit touches and names no network domain, no Vault handle and no script", () => {
  const sheet = sheetOf(kit());
  assert.deepEqual(sheet.recordTypes, TYPES);
  assert.ok(kit().items.every((i) => !("networkDomains" in i) && !("vaultNames" in i)), "no network domain and no Vault handle");
  assert.equal((raw()["scripts"] ?? []).length, 0, "no scripts");
  for (const t of SHEET_TOOLS) assert.ok(sheet.tools.includes(t), `the sheet lists ${t}`);
});

test("every capability a step or tool names exists, no step uses a Kit-forbidden capability, and every step input passes the generated validator", () => {
  const caps = new Map(registry.capabilities.map((c) => [c.name, c]));
  for (const { item: it, which, step } of steps(kit())) {
    assert.ok(caps.has(step.cap), `${it} ${which}: ${step.cap} is not a capability`);
    assert.deepEqual(validateInput(step.cap, 1, step.input), [], `${it} ${which}: ${step.cap} input`);
  }
  for (const it of kit().items) for (const t of it.tools ?? []) assert.ok(caps.has(t), `${it.key}: tool ${t} is not a capability`);
});

test("every write step that needs an idempotency key carries a stable one, unique across the Kit", () => {
  const keys: string[] = [];
  for (const { item: it, step } of steps(kit())) {
    const cap = registry.capabilities.find((c) => c.name === step.cap)!;
    if (cap.idempotency === "key") {
      const key = step.input["idempotencyKey"];
      assert.equal(typeof key, "string", `${it}: ${step.cap} needs an idempotencyKey`);
      keys.push(key as string);
    }
  }
  assert.ok(keys.length >= 5);
  assert.equal(new Set(keys).size, keys.length, "idempotency keys are unique");
  assert.ok(keys.every((k) => k.startsWith(`kit.${KEY}.`)), "keys are namespaced by the Kit");
});

// ---- agreement with the manifest ---------------------------------------------------------------------------------------------------

test("the record types match what the manifest declares: title, plural, icon, group, label, status and owner fields, and field keys and types", () => {
  const made = typeOps();
  assert.deepEqual(made.map((o) => o["type"]).sort(), TYPES);
  for (const op of made) {
    const declared = registry.recordTypes.find((r) => r.key === op["type"] && r.module === KEY) as Obj | undefined;
    assert.ok(declared, `the manifest declares ${op["type"]}`);
    const d = op["def"] as Obj;
    for (const k of ["title", "plural", "icon", "group", "label"] as const) assert.equal(d[k], declared[k], `${op["type"]}.${k}`);
    for (const k of ["titleField", "statusField", "ownerField"] as const) assert.equal(d[k], declared[k] === undefined ? undefined : snake(declared[k] as string), `${op["type"]}.${k}`);
    assert.deepEqual((d["fields"] as Obj[]).map((f) => [f["key"], f["type"]]), (declared["fields"] as Obj[]).map((f) => [snake(f["key"] as string), f["type"]]), `${op["type"]} fields`);
    const keys = (d["fields"] as Obj[]).map((f) => f["key"]);
    for (const k of ["titleField", "statusField", "ownerField"] as const) if (d[k] !== undefined) assert.ok(keys.includes(d[k]), `${op["type"]}.${k} is one of its fields`);
  }
});

test("the layout of each type shows only fields the type has, every field once", () => {
  const types = new Map(typeOps().map((o) => [o["type"], ((o["def"] as Obj)["fields"] as Obj[]).map((f) => f["key"])] as const));
  const layouts = steps(kit()).filter((s) => s.step.cap === "schema.layout.set");
  assert.deepEqual(layouts.map((l) => l.step.input["type"]).sort(), TYPES, "every type the Kit creates has a layout");
  for (const { step } of layouts) {
    const have = types.get(step.input["type"] as string);
    assert.ok(have, "layout for a type this Kit creates");
    const shown = (step.input["sections"] as Obj[]).flatMap((sec) => sec["fields"] as string[]);
    for (const f of shown) assert.ok(have.includes(f), `${step.input["type"]}.${f}`);
    assert.equal(new Set(shown).size, shown.length, `${step.input["type"]}: no field twice`);
    assert.deepEqual([...shown].sort(), [...have].sort(), `${step.input["type"]}: every field is on the page`);
  }
});

test("the status field of each type lists its stages once, with titles", () => {
  for (const op of typeOps()) {
    const status = ((op["def"] as Obj)["fields"] as Obj[]).find((f) => f["key"] === (op["def"] as Obj)["statusField"]);
    if (!status) continue;
    const stages = ((status["options"] as Obj | undefined)?.["stages"] ?? []) as { key: string; title: string }[];
    if (op["type"] === STAGED_TYPE) {
      assert.deepEqual(stages.map((s) => s.key), STAGE_KEYS);
      assert.ok(stages.every((s) => s.title.length > 0));
    }
    assert.equal(new Set(stages.map((s) => s.key)).size, stages.length);
  }
});

test("the Journey is built on a type this Kit creates, with ordered stages, a final stage, unique task keys and a start rule", () => {
  const input = stepInput(JOURNEY_ITEM);
  const subject = input["subjectType"] as string;
  assert.ok(typeOps().some((o) => o["type"] === subject), "the subject type is made by this Kit, earlier in the item list");
  const at = (k: string): number => kit().items.findIndex((i) => i.key === k);
  assert.ok(at(`rt.${subject}`) < at(JOURNEY_ITEM), "the type is created before the Journey that needs it");
  const stages = input["stages"] as { key: string; order: number; tasks: { key: string; kind?: string; assigned: Obj }[]; final?: boolean; automations: unknown[] }[];
  assert.deepEqual(stages.map((s) => s.key), JOURNEY_STAGES);
  assert.deepEqual(stages.map((s) => s.order), stages.map((_, i) => i), "orders run 0, 1, 2 ...");
  assert.ok(stages.slice(-1)[0]!.final, "the last stage is final");
  assert.ok(stages.slice(0, -1).filter((s) => s.final).length <= 1, "at most one other final stage");
  const taskKeys = stages.flatMap((s) => s.tasks.map((t) => `${s.key}.${t.key}`));
  assert.equal(new Set(taskKeys).size, taskKeys.length);
  assert.ok(stages.every((s) => s.automations.length === 0), "a Kit cannot name an Automation id it does not know yet");
  for (const s of stages) for (const t of s.tasks) assert.deepEqual(t.assigned, { kind: "role", id: "admin" }, `${s.key}.${t.key} is assigned to a role, never a named person`);
  assert.deepEqual(input["startRule"], { event: "record.created", enabled: true });
  assert.ok(registry.events.some((e) => e.name === "record.created"), "the start event exists");
});

test("the form is on a type this Kit creates and has a valid kind", () => {
  const input = stepInput(FORM_ITEM);
  assert.ok(typeOps().some((o) => o["type"] === input["recordType"]));
  assert.ok(["public", "one_use", "booking", "survey"].includes(input["kind"] as string));
  assert.equal(input["kind"], FORM_KIND);
});

test("the Automation uses a trigger and steps that exist, with a path from the trigger to the last step", () => {
  const create = stepInput(AUTO_ITEM);
  const def = create["definition"] as { triggers: { key: string }[]; nodes: { id: string; key: string; next?: string[] }[] };
  assert.deepEqual(def.triggers.map((t) => t.key), ["form_submit"]);
  assert.ok(registry.triggers.some((t) => t.key === "form_submit"), "the trigger is in the catalogue");
  const stepKeys = new Set(registry.steps.map((s) => s.key));
  for (const n of def.nodes) assert.ok(stepKeys.has(n.key), `step ${n.key} exists`);
  const ids = new Set(def.nodes.map((n) => n.id));
  assert.equal(ids.size, def.nodes.length);
  for (const n of def.nodes) for (const to of n.next ?? []) assert.ok(ids.has(to), `${n.id} -> ${to}`);
  assert.equal(def.nodes.filter((n) => !def.nodes.some((m) => (m.next ?? []).includes(n.id))).length, 1, "exactly one first step");
  assert.deepEqual(validateInput("automations.validate", 1, { definition: def }), []);
});

test("the agent may use only capabilities that exist, lists them as the item's tools too, and denies nothing it also allows", () => {
  const it = item(AGENT_ITEM);
  const tools = (it.apply!.input["tools"] as { allowed: string[]; denied: string[] });
  assert.deepEqual([...tools.allowed].sort(), [...(it.tools ?? [])].sort(), "the install sheet shows exactly what the agent may call");
  assert.equal(tools.allowed.filter((t) => tools.denied.includes(t)).length, 0);
  const caps = new Set(registry.capabilities.map((c) => c.name));
  for (const t of tools.allowed) assert.ok(caps.has(t), t);
  assert.ok(!tools.allowed.some((t) => /^(vault|kits)\./.test(t)), "never the Vault or Kits");
});

test("the Tax ID is a sealed field with the restricted label, the type is confidential, and no seed or layout step reads it into anything else", () => {
  const plan = typeOps().find((o) => o["type"] === "client_plan")!;
  const taxId = ((plan["def"] as Obj)["fields"] as Obj[]).find((f) => f["key"] === "tax_id")!;
  assert.equal(taxId["type"], "sealed");
  assert.equal(taxId["label"], "restricted");
  assert.equal((plan["def"] as Obj)["label"], "confidential");
  for (const s of seed) assert.equal("tax_id" in (s.input["fields"] as Obj), false);
  const text = JSON.stringify(kit().items.filter((i) => i.type !== "record_type" && i.type !== "layout"));
  assert.equal(/tax_?id|tax id/i.test(text), false, "no Automation, form or agent text mentions the Tax ID");
});

test("the estate Journey runs intake, drafting, review, signing, funding and complete; review has a time limit; signing has a signature task; the client plan stages match", () => {
  const stages = (stepInput("journey.estate_plan")["stages"] as { key: string; final?: boolean; timeLimit?: Obj; tasks: { kind?: string }[] }[]);
  const plan = typeOps().find((o) => o["type"] === "client_plan")!;
  const planStages = ((((plan["def"] as Obj)["fields"] as Obj[]).find((f) => f["key"] === "stage")!["options"] as Obj)["stages"] as { key: string }[]).map((s) => s.key);
  assert.deepEqual(stages.map((s) => s.key), planStages);
  assert.deepEqual(stages.filter((s) => s.final).map((s) => s.key), ["complete"]);
  assert.ok(stages.find((s) => s.key === "review")!.timeLimit, "a draft does not sit in review forever");
  assert.ok(stages.find((s) => s.key === "signing")!.tasks.some((t) => t.kind === "signature"));
  assert.ok(stages.find((s) => s.key === "review")!.tasks.some((t) => t.kind === "review"));
});

test("the drafting assistant can send for signature but only through the Gate: esign.send is an outward capability with a Gate act", () => {
  const cap = registry.capabilities.find((c) => c.name === "esign.send")!;
  assert.equal(cap.effects, "outward");
  assert.ok((cap as Obj)["gate"], "esign.send is held for approval");
  assert.ok(item("agent.drafting_assistant").tools!.includes("esign.send"));
});

// ---- on a fixture Space ----------------------------------------------------------------------------------------------------------

test("install: the Kit's steps apply in item order, each with its own input, and the types, Journey, form, Automation and agent exist afterwards", async () => {
  const s = new Fixture();
  for (const it of kit().items) if (it.apply) await s.call(it.apply.cap, it.apply.input);
  assert.deepEqual(s.calls.map((c) => c.cap), kit().items.flatMap((i) => (i.apply ? [i.apply.cap] : [])));
  assert.deepEqual([...s.types].sort(), TYPES);
  assert.equal(s.journeys.length, 1);
  assert.equal(s.journeys[0]!.subjectType, STAGED_TYPE);
  assert.equal(s.forms.length, 1);
  assert.ok(s.types.includes(s.forms[0]!.recordType), "the form is on a type that exists by then");
  for (const name of ["schema.changed", "journey.created", "automation.created", "agent.created"]) assert.ok(s.log.some((e) => e.name === name), name);
});

test("uninstall: undoing the Kit's reversible items in reverse order drops its record types and nothing else", async () => {
  const s = new Fixture();
  for (const it of kit().items) if (it.apply) await s.call(it.apply.cap, it.apply.input);
  for (const it of [...kit().items].reverse()) if (it.undo) await s.call(it.undo.cap, it.undo.input);
  assert.deepEqual(s.types, []);
});

test("the Kit's own declared tests pass on a fixture Space that answers like the real neighbours", async () => {
  assert.ok((kit().tests ?? []).length >= 2);
  assert.deepEqual(await runDeclared(kit()), []);
});

test("a Kit that loses its record type fails its own test and names it", async () => {
  const broken = kit();
  broken.items = broken.items.filter((i) => i.key !== `rt.${TYPES[0]}`);
  const failures = await runDeclared(broken);
  assert.ok(failures.length >= 1);
  assert.match(failures.map((f) => f.message).join("\n"), new RegExp(TYPES[0]!));
});

test("a Kit that loses its Journey fails its own test and names the event", async () => {
  const broken = kit();
  broken.items = broken.items.filter((i) => i.key !== JOURNEY_ITEM);
  assert.match((await runDeclared(broken)).map((f) => f.message).join("\n"), /journey\.created/);
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

test("items that create things by id (the Journey, form, Automation and agent) carry no undo: a Kit step cannot name an id it does not know yet", () => {
  const k = kit();
  for (const key of [JOURNEY_ITEM, FORM_ITEM, AUTO_ITEM, AGENT_ITEM]) assert.equal(k.items.find((i) => i.key === key)!.undo, undefined, key);
  for (const { item: it, which, step } of steps(k)) if (which === "undo") assert.ok(!["automations.delete", "agents.delete", "journeys.delete", "forms.delete"].includes(step.cap), `${it}: an undo by id would be refused`);
});

test("the seed recipe creates records of the Kit's own types, with fields those types have, stages they list, and unique idempotency keys that pass the generated validator", () => {
  assert.ok(seed.length >= 2);
  const defs = new Map(typeOps().map((o) => [o["type"], o["def"] as Obj] as const));
  const keys = new Set<string>();
  for (const s of seed) {
    assert.equal(s.cap, "records.create");
    assert.deepEqual(validateInput(s.cap, 1, s.input), []);
    const def = defs.get(s.input["type"] as string);
    assert.ok(def, `${String(s.input["type"])} is a type of this Kit`);
    const fields = def["fields"] as Obj[];
    for (const [k, v] of Object.entries(s.input["fields"] as Obj)) {
      const f = fields.find((x) => x["key"] === k);
      assert.ok(f, `${String(s.input["type"])}.${k} is a field`);
      assert.notEqual(f["type"], "sealed", `${k} is sealed and is never seeded`);
      if (f["type"] === "status" && f["options"]) assert.ok(((f["options"] as Obj)["stages"] as { key: string }[]).some((st) => st.key === v), `${k}=${String(v)} is one of its stages`);
    }
    keys.add(s.input["idempotencyKey"] as string);
  }
  assert.equal(keys.size, seed.length);
  assert.ok([...keys].every((k) => k.startsWith(`seed.${KEY}.`)));
});
