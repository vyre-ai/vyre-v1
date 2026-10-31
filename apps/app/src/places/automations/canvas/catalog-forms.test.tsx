// The guard against a panel with no fields: every step and every trigger in the catalog (generated/registry.json, the source of automations.steps.list and automations.triggers.list) is rendered
// in the step panel, and each required config field must have an editable control there. A step or trigger added to the catalog without a form fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "./Inspector.tsx";
import { AutomationsDataProvider } from "./data.tsx";
import { controlsFor, requiredOf, resolveSchema, TRIGGER_SPECS } from "./form-model.ts";
import { check } from "./model.ts";
import type { DefNode, DefTrigger, Definition } from "./model.ts";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";

interface RegStep { key: string; title: string; input: unknown }
interface RegTrigger { key: string; title: string; payload?: unknown; source: { filter?: { properties?: Record<string, unknown>; required?: string[] } } }
const registry = JSON.parse(readFileSync(new URL("../../../../../../generated/registry.json", import.meta.url), "utf8")) as { steps: RegStep[]; triggers: RegTrigger[]; $defs: Record<string, unknown> };
const data = createSampleAutomations(northwind).data;

// The step palette puts each $ref in place before it reaches the panel (modules/automations/handlers/defs.ts inlineRefs); this does the same to the registry.
const schemaOf = (s: RegStep): unknown => resolveSchema(s.input, registry.$defs);

function page(def: Definition, node: DefNode | null, schema: unknown, trigger: DefTrigger | null = null, triggerIndex: number | null = null): string {
  return renderToStaticMarkup(
    <AutomationsDataProvider value={data}>
      <Inspector def={def} node={node} trigger={trigger} triggerIndex={triggerIndex} issues={check(def, "space")} keys={[]} kind="space" inputSchema={schema} onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
}
const ids = (out: string): Set<string> => new Set([...out.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]!));
/** The tag that carries a test id, when it is a control a person can use: an input, a text box or a button, not read only and not disabled. */
function control(out: string, id: string): boolean {
  const tag = out.match(new RegExp(`<([a-z]+)[^>]*data-testid="${id}"[^>]*>`));
  // the text message body is a rich editor, which mounts on a div
  return !!tag && (["input", "textarea", "button"].includes(tag[1]!) || id === "richeditor-host") && !/readonly|disabled/.test(tag[0]);
}

/** Where a required field is edited when the step has a form of its own (HTTP request, Run code, AI, the message composers, the lanes of Paths and Parallel). Everything else is `field-<name>`. */
const OWNED: Record<string, Record<string, string[]>> = {
  http_request: { method: ["field-method"], url: ["field-url"] },
  code: { source: ["field-source"] },
  ai: { prompt: ["field-prompt"] },
  send_email: { to: ["composer-to"], subject: ["em-subject"], body: ["em-plain"] },
  send_sms: { to: ["composer-to"], body: ["richeditor-host"] },
  paths: { paths: ["field-path-0"] },
  parallel: { branches: ["field-lane-0"] },
};
const ACCOUNT_FIELDS = new Set(["connectionId", "mailboxId", "numberId", "connector"]);

function blank(key: string): DefNode {
  if (key === "paths") return { id: "n", key, input: {}, branches: [{ label: "Path 1", to: "", when: "" }, { label: "Otherwise", to: "" }] };
  if (key === "parallel") return { id: "n", key, input: { waitFor: "all" }, branches: [{ label: "Lane 1", to: "" }, { label: "Lane 2", to: "" }] };
  return { id: "n", key, input: {} };
}

test("the catalog is the one the panel is checked against", () => {
  assert.ok(registry.steps.length >= 60, `${registry.steps.length} steps`);
  assert.equal(registry.triggers.length, Object.keys(TRIGGER_SPECS).length, "a form for every trigger and no spare");
  assert.deepEqual(registry.triggers.map((t) => t.key).sort(), Object.keys(TRIGGER_SPECS).sort());
});

test("every step in the catalog has an editable control for each required field", () => {
  const without: string[] = [];
  let checked = 0;
  for (const step of registry.steps) {
    const schema = schemaOf(step);
    const node = blank(step.key);
    const def: Definition = { triggers: [{ key: "manual" }], nodes: [node] };
    const out = page(def, node, schema);
    const have = ids(out);
    assert.ok(have.has("field-title"), `${step.key} has its Name field`);
    for (const name of requiredOf(schema)) {
      checked += 1;
      const candidates = OWNED[step.key]?.[name] ?? [`field-${name}`];
      if (ACCOUNT_FIELDS.has(name)) candidates.push("choose-account");
      const hit = candidates.find((id) => control(out, id));
      if (!hit) without.push(`${step.key}.${name}`);
    }
  }
  assert.ok(checked > 80, `${checked} required fields were checked`);
  assert.deepEqual(without, [], "a required field with no control");
});

test("every property of every step gets a control, so nothing the catalog lists is out of reach", () => {
  const lost: string[] = [];
  for (const step of registry.steps) {
    const schema = schemaOf(step) as { properties?: Record<string, unknown> };
    const names = Object.keys(schema.properties ?? {});
    const made = new Set(controlsFor(schema).map((c) => c.name));
    for (const n of names) if (!made.has(n)) lost.push(`${step.key}.${n}`);
  }
  assert.deepEqual(lost, []);
});

test("the steps that had no form: their schema was a bare reference, and now lists its fields", () => {
  const bare = registry.steps.filter((s) => s.input && typeof s.input === "object" && "$ref" in (s.input as object)).map((s) => s.key).sort();
  assert.deepEqual(bare, ["files.copy", "files.move", "files.share", "github.pull_request.get", "google.gmail.list_messages", "google.sheets.get_values", "records.relate"]);
  for (const key of bare) {
    const schema = schemaOf(registry.steps.find((s) => s.key === key)!);
    assert.ok(controlsFor(schema).length > 0, `${key} has controls once the reference is followed`);
    assert.equal(controlsFor(registry.steps.find((s) => s.key === key)!.input).length, 0, `${key} had none before`);
  }
});

test("every trigger in the catalog has a form: its name, its required fields and, for a schedule, the picker", () => {
  const without: string[] = [];
  for (const t of registry.triggers) {
    const trigger: DefTrigger = { key: t.key };
    const def: Definition = { triggers: [trigger], nodes: [] };
    const out = page(def, null, undefined, trigger, 0);
    if (!control(out, "trigger-label")) without.push(`${t.key}.label`);
    if (t.key === "schedule") {
      for (const id of ["schedule-picker", "schedule-every", "schedule-time", "schedule-zone-change", "schedule-advanced"]) if (!ids(out).has(id)) without.push(`schedule.${id}`);
      continue;
    }
    for (const f of TRIGGER_SPECS[t.key]!.fields) if (f.required && !control(out, `trigger-${f.name}`)) without.push(`${t.key}.${f.name}`);
    for (const f of TRIGGER_SPECS[t.key]!.fields) if (!control(out, `trigger-${f.name}`)) without.push(`${t.key}.${f.name} (optional)`);
  }
  assert.deepEqual(without, []);
});

test("a trigger form asks only for keys the trigger consumer matches, and for each of them", () => {
  for (const t of registry.triggers) {
    if (t.key === "schedule") continue;
    const filterProps = Object.keys(t.source.filter?.properties ?? {});
    const payloadProps = Object.keys((resolveSchema(t.payload, registry.$defs) as { properties?: Record<string, unknown> } | undefined)?.properties ?? {});
    const asked = TRIGGER_SPECS[t.key]!.fields.map((f) => f.name);
    for (const name of asked) assert.ok(filterProps.length > 0 ? filterProps.includes(name) : payloadProps.includes(name), `${t.key}: ${name} is not something this trigger can be narrowed by`);
    for (const name of filterProps) assert.ok(asked.includes(name), `${t.key}: the filter key ${name} has no field`);
    for (const name of t.source.filter?.required ?? []) assert.ok(TRIGGER_SPECS[t.key]!.fields.find((f) => f.name === name)?.required, `${t.key}: ${name} is required by the catalog`);
  }
});

test("the screenshot: three triggers in one block each open their own form, a schedule included", () => {
  const triggers: DefTrigger[] = [{ key: "manual" }, { key: "form_submit" }, { key: "schedule" }];
  const def: Definition = { triggers, nodes: [] };
  const out = page(def, null, undefined, triggers[2]!, 2);
  assert.ok(ids(out).has("schedule-picker"), "the schedule has its picker");
  assert.ok(ids(out).has("schedule-time") && ids(out).has("schedule-zone"), "a time and a time zone");
  assert.ok(out.includes("This is trigger 3 of 3"), "the line that was all there was is still there, below the form");
  assert.ok(out.includes("Next 3 runs"), "and the next runs");
});
