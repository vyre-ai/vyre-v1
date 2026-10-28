// Schema fields and shelf lines for the step panel. The app cannot import modules.
import { presenceOf, typeOf } from "../values/typed.ts";
import type { Presence, TypeRef } from "../values/typed.ts";

const ACCOUNT = new Set(["connectionId", "mailboxId", "numberId", "connector"]);

export interface SchemaField {
  name: string;
  required: boolean;
  valueType: TypeRef;
  enumValues: string[];
  presence: Presence;
}

export interface ShelfLine {
  id: string;
  text: string;
}

export interface StepFixture {
  definitionVersion: number;
  stepKey: string;
  output: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaType(prop: unknown): TypeRef {
  if (!isRecord(prop)) return "unknown";
  const raw = prop["type"];
  const name = Array.isArray(raw) ? raw.find((item) => item !== "null") : raw;
  if (name === "integer") return "number";
  if (name === "string" || name === "number" || name === "boolean" || name === "object" || name === "array") return name;
  return "unknown";
}

function enumValues(prop: unknown): string[] {
  if (!isRecord(prop) || !Array.isArray(prop["enum"])) return [];
  return prop["enum"].filter((item): item is string => typeof item === "string");
}

/** Fields the schema names, including ones the step has not filled in yet. Account fields stay on the account row. */
export function fieldsFromSchema(schema: unknown, input: Record<string, unknown>): SchemaField[] {
  if (!isRecord(schema) || !isRecord(schema["properties"])) return [];
  const required = new Set(Array.isArray(schema["required"]) ? schema["required"].filter((name): name is string => typeof name === "string") : []);
  const out: SchemaField[] = [];
  for (const name of Object.keys(schema["properties"] as Record<string, unknown>)) {
    if (ACCOUNT.has(name)) continue;
    const prop = (schema["properties"] as Record<string, unknown>)[name];
    const hasKey = Object.prototype.hasOwnProperty.call(input, name);
    out.push({
      name,
      required: required.has(name),
      valueType: schemaType(prop),
      enumValues: enumValues(prop),
      presence: presenceOf(hasKey, input[name]),
    });
  }
  return out;
}

export function asFixture(version: number, stepKey: string, output: unknown): StepFixture {
  return { definitionVersion: version, stepKey, output };
}

export function isFixture(value: unknown): value is StepFixture {
  return isRecord(value) && typeof value["definitionVersion"] === "number" && typeof value["stepKey"] === "string" && "output" in value;
}

function sampleText(value: unknown): string {
  if (value === null) return "null";
  if (value === "") return "empty";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

/** Trigger and prior steps, with type and missing/null/empty kept apart. A stored fixture names its definition version. */
export function shelfLines(triggerSample: unknown, steps: readonly { id: string; title: string; output: unknown }[]): ShelfLine[] {
  const lines: ShelfLine[] = [];
  if (triggerSample !== undefined) {
    const output = isFixture(triggerSample) ? triggerSample.output : triggerSample;
    const version = isFixture(triggerSample) ? ` version ${triggerSample.definitionVersion}` : "";
    lines.push({ id: "trigger", text: `Trigger${version} (${typeOf(output)}, ${presenceOf(true, output)}): ${sampleText(output)}` });
  }
  for (const step of steps) {
    if (step.output === undefined) continue;
    const output = isFixture(step.output) ? step.output.output : step.output;
    const version = isFixture(step.output) ? `, version ${step.output.definitionVersion}` : "";
    lines.push({ id: step.id, text: `${step.title}${version} (${typeOf(output)}, ${presenceOf(true, output)}): ${sampleText(output)}` });
  }
  return lines;
}

export function fixtureNote(version: number, stepKey: string): string {
  return `Fixture for ${stepKey} on definition version ${version}. Reads may run live. Writes and sends stay stubbed.`;
}
