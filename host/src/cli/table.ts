// The generated command table (generated/cli.ts: one row per capability that declares a `cli` name) turned into commands: find the row for the words typed, map positionals and flags onto the
// capability's input schema, type each value by that schema, fill the idempotency key, and say what is missing. No command here is written by hand; a new `cli:` in a manifest is a new command.
import { cliCommands } from "../../../generated/cli.ts";
import { registry } from "../../../generated/registry.ts";
import { camel, parseArgs } from "./args.ts";
import type { Parsed } from "./args.ts";

export interface Row { words: string[]; flags: string[]; cap: string; v: number; command: string }
interface Prop { type?: string | string[]; description?: string; enum?: unknown[] }
export interface CapInfo { name: string; v: number; summary: string; props: Record<string, Prop>; required: string[]; effects: string }

const rows: Row[] = cliCommands.map((c) => {
  const parts = c.command.replace(/^vyre\s+/, "").split(/\s+/);
  return { words: parts.filter((p) => !p.startsWith("--")), flags: parts.filter((p) => p.startsWith("--")).map((p) => p.slice(2)), cap: c.cap, v: c.v, command: c.command };
});

export const commandRows = (): readonly Row[] => rows;

const capIndex = new Map<string, CapInfo>();
export function capInfo(name: string, v = 1): CapInfo | null {
  const key = `${name}@${v}`;
  const hit = capIndex.get(key);
  if (hit) return hit;
  const c = (registry.capabilities as unknown as { name: string; v: number; summary: string; effects: string; input?: { properties?: Record<string, Prop>; required?: string[] } }[]).find((x) => x.name === name && x.v === v);
  if (!c) return null;
  const info: CapInfo = { name: c.name, v: c.v, summary: c.summary, props: c.input?.properties ?? {}, required: c.input?.required ?? [], effects: c.effects };
  capIndex.set(key, info);
  return info;
}

/** The row whose words are the longest prefix of the leading words typed (flags in the row name, like `run --env`, must be present). */
export function resolveRow(tokens: readonly string[], flags: ReadonlyMap<string, string | true>): { row: Row; used: number } | null {
  let best: { row: Row; used: number } | null = null;
  for (const row of rows) {
    if (row.words.length > tokens.length) continue;
    if (!row.words.every((w, i) => tokens[i] === w)) continue;
    if (!row.flags.every((f) => flags.has(f))) continue;
    if (!best || row.words.length > best.row.words.length) best = { row, used: row.words.length };
  }
  return best;
}

const typesOf = (p: Prop | undefined): string[] => (p?.type === undefined ? [] : Array.isArray(p.type) ? p.type : [p.type]);

/** Flags that must not swallow the next word: booleans of this capability plus the CLI's own. */
export function booleanFlags(info: CapInfo | null): Set<string> {
  const out = new Set(["json", "help", "offline", "wait", "no-wait", "dry-run", "yes"]);
  if (info) for (const [k, p] of Object.entries(info.props)) if (typesOf(p).includes("boolean")) out.add(k).add(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
  return out;
}

export function coerceValue(name: string, raw: string | true, p: Prop | undefined): { ok: true; value: unknown } | { ok: false; why: string } {
  const t = typesOf(p);
  if (raw === true) return t.includes("boolean") || t.length === 0 ? { ok: true, value: true } : { ok: false, why: `--${name} needs a value` };
  if (t.includes("boolean") && t.length === 1) {
    if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
    return { ok: false, why: `--${name} is true or false` };
  }
  if ((t.includes("integer") || t.includes("number")) && !t.includes("string")) {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isFinite(n) && (t.includes("number") || Number.isInteger(n)) ? { ok: true, value: n } : { ok: false, why: `--${name} is a ${t.includes("integer") ? "whole " : ""}number` };
  }
  if (t.length === 1 && t[0] === "string") return { ok: true, value: raw };
  try { return { ok: true, value: JSON.parse(raw) as unknown }; }
  catch { return t.length === 0 || t.includes("string") ? { ok: true, value: raw } : { ok: false, why: `--${name} is JSON` }; }
}

export type Built = { ok: true; input: Record<string, unknown> } | { ok: false; problems: string[] };

/** Positionals fill the required fields in schema order; flags (`--field`, `--field-name`) fill any field; `--input '{...}'` or `--json-input` is the base. */
export function buildInput(info: CapInfo, parsed: Parsed, used: number, mint: () => string): Built {
  const problems: string[] = [];
  const input: Record<string, unknown> = {};
  const base = parsed.flags.get("input-json");
  if (typeof base === "string") {
    try { const j = JSON.parse(base) as unknown; if (j && typeof j === "object" && !Array.isArray(j)) Object.assign(input, j); else problems.push("--input-json must be a JSON object"); }
    catch { problems.push("--input-json is not JSON"); }
  }
  const reserved = new Set(["json", "help", "server", "token", "data-dir", "offline", "input-json", "wait", "no-wait", "yes"]);
  for (const [flag, raw] of parsed.flags) {
    if (reserved.has(flag)) continue;
    const name = info.props[flag] ? flag : camel(flag);
    const p = info.props[name];
    if (!p && !(name in info.props)) { problems.push(`--${flag} is not an input of ${info.name} (fields: ${Object.keys(info.props).join(", ") || "none"})`); continue; }
    const c = coerceValue(flag, raw, p);
    if (c.ok) input[name] = c.value; else problems.push(c.why);
  }
  const words = parsed.positional.slice(used);
  const wanted = info.required.filter((r) => r !== "idempotencyKey" && !(r in input));
  words.forEach((w, i) => {
    const name = wanted[i];
    if (!name) { problems.push(`unexpected argument "${w}"`); return; }
    const c = coerceValue(name, w, info.props[name]);
    if (c.ok) input[name] = c.value; else problems.push(c.why.replace(`--${name}`, name));
  });
  if ("idempotencyKey" in info.props && input["idempotencyKey"] === undefined) input["idempotencyKey"] = mint();
  const missing = info.required.filter((r) => input[r] === undefined);
  if (missing.length) problems.push(`missing: ${missing.join(", ")}`);
  return problems.length ? { ok: false, problems } : { ok: true, input };
}

/** The help for one command: summary, usage and input fields. */
export function helpFor(row: Row, info: CapInfo | null): string {
  if (!info) return `${row.command}\n`;
  const req = info.required.filter((r) => r !== "idempotencyKey");
  const usage = `${row.command}${req.map((r) => ` <${r}>`).join("")}${Object.keys(info.props).some((k) => !info.required.includes(k)) ? " [--field value ...]" : ""}`;
  const fields = Object.entries(info.props).map(([k, p]) => `  ${k}${info.required.includes(k) && k !== "idempotencyKey" ? " (required)" : ""}  ${typesOf(p).join("|") || "json"}${p.description ? `  ${p.description}` : ""}`);
  return `${usage}\n${info.summary}\n${fields.length ? `\nInput fields\n${fields.join("\n")}\n` : ""}\nAlso: --json for raw output, --input-json '{...}' for the whole input, --server URL, --token T.\n`;
}

export { parseArgs };
