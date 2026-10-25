// The frozen contract, for tests: the schema of a capability's input or output, of an event's payload and of a native block's data, read from generated/registry.json.
// The checker is the same small JSON Schema subset the contract tests use (packages/contracts/src/jsonschema.ts, copied here because a package may not import it: boundary layer rule).
import { readFileSync } from "node:fs";

interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: Schema[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  $ref?: string;
}
type Defs = Record<string, Schema> | undefined;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}
const typeOk = (want: string, got: string): boolean => want === got || (want === "number" && got === "integer");

function deref(s: Schema, defs: Defs): Schema {
  let cur = s;
  for (let i = 0; cur.$ref && i < 20; i++) {
    const next = defs?.[cur.$ref.replace("#/$defs/", "")];
    if (!next) throw new Error(`unresolved $ref ${cur.$ref}`);
    cur = next;
  }
  return cur;
}

function walk(s0: Schema, v: unknown, p: string, out: string[], defs: Defs): void {
  const s = deref(s0, defs);
  const at = p || "/";
  if (s.anyOf) {
    const attempts = s.anyOf.map((sub) => check(sub, v, p, defs));
    if (!attempts.some((a) => a.length === 0)) out.push(`${at}: matches none of anyOf`);
    return;
  }
  if (s.const !== undefined && JSON.stringify(s.const) !== JSON.stringify(v)) out.push(`${at}: not the constant`);
  if (s.enum && !s.enum.some((x) => JSON.stringify(x) === JSON.stringify(v))) out.push(`${at}: not in enum`);
  const got = typeOf(v);
  if (s.type) {
    const want = Array.isArray(s.type) ? s.type : [s.type];
    if (!want.some((w) => typeOk(w, got))) { out.push(`${at}: expected ${want.join("|")} got ${got}`); return; }
  }
  if (typeof v === "string") {
    if (s.minLength !== undefined && v.length < s.minLength) out.push(`${at}: too short`);
    if (s.maxLength !== undefined && v.length > s.maxLength) out.push(`${at}: too long`);
    if (s.pattern !== undefined && !new RegExp(s.pattern).test(v)) out.push(`${at}: pattern ${s.pattern}`);
  }
  if (typeof v === "number") {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${at}: below minimum`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${at}: above maximum`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: too few items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${at}: too many items`);
    const items = s.items;
    if (items) v.forEach((x, i) => walk(items, x, `${p}/${i}`, out, defs));
  }
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) out.push(`${p}/${k}: required`);
    const props = s.properties ?? {};
    for (const [k, x] of Object.entries(o)) {
      const sub = props[k];
      if (sub) walk(sub, x, `${p}/${k}`, out, defs);
      else if (s.additionalProperties === false) out.push(`${p}/${k}: unknown property`);
      else if (typeof s.additionalProperties === "object") walk(s.additionalProperties, x, `${p}/${k}`, out, defs);
    }
  }
}

function check(schema: Schema, value: unknown, path: string, defs: Defs): string[] {
  const out: string[] = [];
  walk(schema, value, path, out, defs);
  return out;
}

interface Registry {
  $defs: Defs;
  capabilities: Array<{ name: string; v: number; input: Schema; output: Schema }>;
  events: Array<{ name: string; payload: Schema }>;
  blocks: Array<{ type: string; data: Schema }>;
}

let cached: Registry | null = null;
const registry = (): Registry => {
  cached ??= JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
  return cached;
};

export function eventErrors(name: string, payload: unknown): string[] {
  const r = registry();
  const def = r.events.find((e) => e.name === name);
  return def ? check(def.payload, payload, "", r.$defs) : [`event ${name} is not in the registry`];
}

export function blockErrors(type: string, data: unknown): string[] {
  const r = registry();
  const def = r.blocks.find((b) => b.type === type);
  return def ? check(def.data, data, "", r.$defs) : [`block ${type} is not in the registry`];
}

/** Errors of a value against the frozen input or output of a capability (its latest version); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const r = registry();
  const def = r.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return check(side === "in" ? def.input : def.output, value, "", r.$defs);
}
