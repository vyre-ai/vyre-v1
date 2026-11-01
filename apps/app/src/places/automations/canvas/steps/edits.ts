// The edits the HTTP request, Run code and AI step forms make, as data in and data out, so each control is one tested function. Nothing here holds a key: the HTTP step names a Vault item by handle,
// and a header that would carry a login is refused before it reaches the definition.
import type { DefNode } from "../model.ts";

export type Input = Record<string, unknown>;
export type Edit<T> = { ok: true; value: T } | { ok: false; message: string };

// ---- rows of name and value (query, headers, mapped input)

export interface Pair { key: string; value: string }

export function pairsOf(record: unknown): Pair[] {
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  return Object.entries(record as Record<string, unknown>).map(([key, v]) => ({ key, value: typeof v === "string" ? v : JSON.stringify(v) }));
}

/** A number, a true or false, null, or JSON typed into a value stays that; anything else is text. Templates ({{ ... }}) are text. */
export function typedText(text: string): unknown {
  const t = text.trim();
  if (t === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^[[{]/.test(t) && !t.startsWith("{{")) { try { return JSON.parse(t) as unknown; } catch { return text; } }
  return text;
}

/** The rows as a record. A row with no name is dropped, and a later row with the same name wins. No rows: undefined, so the key leaves the definition. */
export function recordOf(pairs: readonly Pair[], typed: boolean): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const p of pairs) {
    const name = p.key.trim();
    if (name === "") continue;
    out[name] = typed ? typedText(p.value) : p.value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export const withField = (input: Input, name: string, value: unknown): Input => {
  const next = { ...input };
  if (value === undefined) delete next[name]; else next[name] = value;
  return next;
};

// ---- HTTP request

export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export const readsOnly = (method: unknown): boolean => method === "GET" || method === "HEAD";
const SECRET_NAME = /(authorization|cookie|token|secret|password|api[-_]?key|credential|x-auth)/i;
const OWN_HEADER = /^(host|content-length|connection|transfer-encoding|upgrade|te|keep-alive|proxy-.*|trailer|expect)$/i;

/** Why this header name cannot be typed into the definition, in words. */
export function headerProblem(name: string): string | null {
  const n = name.trim();
  if (n === "") return null;
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(n)) return `${n} is not a header name.`;
  if (OWN_HEADER.test(n)) return `${n} is set by the step.`;
  if (SECRET_NAME.test(n)) return `${n} would carry a key. Pick the key under Authentication so it stays in the Vault.`;
  return null;
}

/** The method; a read has no body, so choosing GET or HEAD takes it away. */
export function setMethod(input: Input, method: HttpMethod): Input {
  const next = withField(input, "method", method);
  if (readsOnly(method)) { delete next["json"]; delete next["text"]; }
  return next;
}

export type BodyKind = "none" | "json" | "text";
export const bodyKindOf = (input: Input): BodyKind => (input["json"] !== undefined ? "json" : input["text"] !== undefined ? "text" : "none");

export function setBodyKind(input: Input, kind: BodyKind): Input {
  const next = { ...input };
  delete next["json"]; delete next["text"];
  if (kind === "json") next["json"] = bodyKindOf(input) === "json" ? input["json"] : {};
  if (kind === "text") next["text"] = "";
  return next;
}

export function setJsonBody(input: Input, text: string): Edit<Input> {
  if (text.trim() === "") return { ok: true, value: withField(input, "json", {}) };
  try { return { ok: true, value: withField(input, "json", JSON.parse(text) as unknown) }; } catch { return { ok: false, message: "The body is not valid JSON yet." }; }
}

export type AuthKind = "none" | "bearer" | "basic" | "header";
export interface Auth { kind: AuthKind; handle: string; username: string; header: string }

export function authOf(input: Input): Auth {
  const a = input["auth"];
  if (!a || typeof a !== "object" || Array.isArray(a)) return { kind: "none", handle: "", username: "", header: "" };
  const r = a as Record<string, unknown>;
  const kind = r["kind"] === "bearer" || r["kind"] === "basic" || r["kind"] === "header" ? r["kind"] : "none";
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  return { kind, handle: s(r["handle"]), username: s(r["username"]), header: s(r["header"]) };
}

/** `#Acme_API.api_key` into the item handle and the field. */
export function splitHandle(handle: string): { item: string; field: string } {
  const at = handle.indexOf(".");
  return at < 0 ? { item: handle, field: "" } : { item: handle.slice(0, at), field: handle.slice(at + 1) };
}
export const joinHandle = (item: string, field: string): string => (item === "" ? "" : field.trim() === "" ? item : `${item}.${field.trim()}`);

/** The other steps of this Automation that sign with the same Vault item, by title (or kind): the "also used by" line under a chosen key. */
export function sameKeySteps(nodes: readonly DefNode[], self: string, itemHandle: string): string[] {
  if (itemHandle === "") return [];
  const out: string[] = [];
  for (const n of nodes) {
    if (n.id === self) continue;
    const a = authOf((n.input ?? {}) as Input);
    if (a.kind !== "none" && splitHandle(a.handle).item === itemHandle) out.push(n.title && n.title.trim() !== "" ? n.title : n.key);
  }
  return out;
}

/** Write the auth block from its parts. None removes it; a kind keeps only the parts it uses. */
export function setAuth(input: Input, a: Auth): Input {
  if (a.kind === "none") return withField(input, "auth", undefined);
  const block: Record<string, unknown> = { kind: a.kind, handle: a.handle };
  if (a.kind === "basic") block["username"] = a.username;
  if (a.kind === "header") block["header"] = a.header;
  return withField(input, "auth", block);
}

export const AUTH_LABEL: Readonly<Record<AuthKind, string>> = { none: "None", bearer: "Bearer token", basic: "User name and password", header: "A named header" };

// ---- Run code

export const CODE_STARTER = "// input holds this step's mapped data. Return JSON.\nreturn { ok: true };";
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function hostsOf(input: Input): string[] {
  return Array.isArray(input["hosts"]) ? (input["hosts"] as unknown[]).filter((h): h is string => typeof h === "string") : [];
}

/** One host per line (or comma). A name that is not a host name is named back; the list is kept lower case without repeats. */
export function setHosts(input: Input, text: string): Edit<Input> {
  const list: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const h = raw.trim().toLowerCase();
    if (h === "") continue;
    if (!HOST.test(h)) return { ok: false, message: `${raw.trim()} is not a host name. Use api.example.com or *.example.com.` };
    if (!list.includes(h)) list.push(h);
  }
  if (list.length > 10) return { ok: false, message: "Run code may name at most 10 hosts." };
  return { ok: true, value: withField(input, "hosts", list.length === 0 ? undefined : list) };
}

// ---- AI step

export type Assignee = { kind: "person" | "agent" | "group" | "role" | "automation"; id: string };
type Ai = NonNullable<DefNode["ai"]>;

export function withAi<K extends keyof Ai>(ai: DefNode["ai"], field: K, value: Ai[K] | undefined): Ai {
  const next: Ai = { ...(ai ?? {}) };
  if (value === undefined) delete next[field]; else next[field] = value;
  return next;
}

export function setTimeoutMinutes(ai: DefNode["ai"], text: string): Edit<Ai> {
  const t = text.trim();
  if (t === "") return { ok: true, value: withAi(ai, "timeoutMinutes", undefined) };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > 30) return { ok: false, message: "Minutes is a whole number from 1 to 30." };
  return { ok: true, value: withAi(ai, "timeoutMinutes", n) };
}

export type AnswerKind = "text" | "json";
export const answerKindOf = (input: Input): AnswerKind => (input["outputSchema"] !== undefined ? "json" : "text");
export const EXAMPLE_SCHEMA = { type: "object", required: ["answer"], properties: { answer: { type: "string" } } } as const;

export function setAnswerKind(input: Input, kind: AnswerKind): Input {
  if (kind === "text") return withField(input, "outputSchema", undefined);
  return withField(input, "outputSchema", answerKindOf(input) === "json" ? input["outputSchema"] : EXAMPLE_SCHEMA);
}

/** The shape typed as JSON Schema. It must be an object that says a type or properties, so a typo is caught before the step runs. */
export function setSchemaText(input: Input, text: string): Edit<Input> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, message: "The shape is not valid JSON yet." }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, message: "The shape must be a JSON Schema object." };
  const s = parsed as Record<string, unknown>;
  if (s["type"] === undefined && s["properties"] === undefined && s["enum"] === undefined && s["anyOf"] === undefined) return { ok: false, message: 'The shape needs a "type", for example {"type":"object"}.' };
  return { ok: true, value: withField(input, "outputSchema", parsed) };
}

export const assigneeName = (a: Assignee | undefined, names: (id: string) => string): string => (a ? names(a.id) : "Nobody");

// ---- the agent task kind of the AI step

export type AiMode = "answer" | "task";
export const modeOf = (ai: DefNode["ai"]): AiMode => (ai?.mode === "task" ? "task" : "answer");
export const setMode = (ai: DefNode["ai"], mode: AiMode): Ai => withAi(ai, "mode", mode === "task" ? "task" : undefined);

/** What done means, one check per line. */
export const doneMeansText = (ai: DefNode["ai"]): string => (ai?.doneMeans ?? []).join("\n");
export function setDoneMeans(ai: DefNode["ai"], text: string): Ai {
  const lines = text.split("\n").map((l) => l.replace(/^\s*[-*\u2022]\s*/, "").trim()).filter((l) => l !== "").slice(0, 20);
  return withAi(ai, "doneMeans", lines.length > 0 ? lines : undefined);
}

/** A task may take hours, so its time limit runs to a day; an answer's limit stays the engine's 30 minutes. */
export function setTimeLimit(ai: DefNode["ai"], text: string, max: number): Edit<Ai> {
  const t = text.trim();
  if (t === "") return { ok: true, value: withAi(ai, "timeoutMinutes", undefined) };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > max) return { ok: false, message: `Minutes is a whole number from 1 to ${max}.` };
  return { ok: true, value: withAi(ai, "timeoutMinutes", n) };
}
export function setNudgeMinutes(ai: DefNode["ai"], text: string): Edit<Ai> {
  const t = text.trim();
  if (t === "") return { ok: true, value: withAi(ai, "nudgeMinutes", undefined) };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > 1440) return { ok: false, message: "Minutes is a whole number from 1 to 1440." };
  return { ok: true, value: withAi(ai, "nudgeMinutes", n) };
}

/** The words a person picks for a field's type, and the JSON Schema each stands for. */
export const FIELD_TYPES: ReadonlyArray<{ word: string; schema: Record<string, unknown> }> = [
  { word: "text", schema: { type: "string" } },
  { word: "number", schema: { type: "number" } },
  { word: "whole number", schema: { type: "integer" } },
  { word: "yes/no", schema: { type: "boolean" } },
  { word: "date", schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
  { word: "list", schema: { type: "array", items: { type: "string" } } },
  { word: "record link", schema: { type: "string", pattern: "^rec_[a-z0-9]+$" } },
];
const wordOf = (p: unknown): string | null => FIELD_TYPES.find((t) => JSON.stringify(t.schema) === JSON.stringify(p))?.word ?? null;

/** The deliverable as a list of fields (name and type word), or null when the shape is more than a flat list of simple fields (then the raw shape is shown). */
export function fieldsOf(schema: unknown): Pair[] | null {
  if (schema === undefined) return [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const s = schema as Record<string, unknown>;
  if (s["type"] !== "object" || typeof s["properties"] !== "object" || s["properties"] === null) return null;
  const keys = Object.keys(s).filter((k) => !["type", "properties", "required"].includes(k));
  if (keys.length > 0) return null;
  const out: Pair[] = [];
  for (const [name, p] of Object.entries(s["properties"] as Record<string, unknown>)) {
    const word = wordOf(p);
    if (word === null) return null;
    out.push({ key: name, value: word });
  }
  const required = Array.isArray(s["required"]) ? (s["required"] as unknown[]).map(String) : [];
  return required.length === out.length && out.every((o) => required.includes(o.key)) ? out : null;
}

/** The fields back as JSON Schema: every field named is required, because a deliverable that may be missing is not one. An unknown type word is text. */
export function schemaFromFields(pairs: readonly Pair[]): Record<string, unknown> | undefined {
  const named = pairs.filter((p) => p.key.trim() !== "");
  if (named.length === 0) return undefined;
  const properties: Record<string, unknown> = {};
  for (const p of named) properties[p.key.trim()] = (FIELD_TYPES.find((t) => t.word === p.value.trim().toLowerCase()) ?? FIELD_TYPES[0]!).schema;
  return { type: "object", required: named.map((p) => p.key.trim()), properties };
}

// ---- text with data chips (the Goal of a task step)

export type Seg = { kind: "text"; text: string } | { kind: "chip"; ref: string };

/** A template string as alternating text and data pieces: text, chip, text, chip, text. The string is what is stored; the pieces are what the editor draws. */
export function splitTemplate(value: string): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const m of value.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    out.push({ kind: "text", text: value.slice(at, m.index) }, { kind: "chip", ref: m[1]! });
    at = (m.index ?? 0) + m[0].length;
  }
  out.push({ kind: "text", text: value.slice(at) });
  return out;
}
export const joinTemplate = (segs: readonly Seg[]): string => segs.map((s) => (s.kind === "text" ? s.text : `{{ ${s.ref} }}`)).join("");

/** What a chip says: where the data comes from, a dot, and which part of it (Trigger, Trigger · Name, Find rows · Count). */
export function chipLabel(ref: string, titleOf: (stepId: string) => string): string {
  const cap = (w: string): string => w.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  if (ref === "trigger" || ref === "input") return "Trigger";
  const t = /^(?:trigger|input)\.(.+)$/.exec(ref);
  if (t) return `Trigger \u00b7 ${cap(t[1]!)}`;
  const st = /^steps\.([^.\[]+)\.out(?:\.(.+))?$/.exec(ref);
  if (st) return `${titleOf(st[1]!)}${st[2] ? ` \u00b7 ${cap(st[2])}` : ""}`;
  return ref;
}

/** Take one chip out, closing the gap; a chip is the only thing between two pieces of text, so they join. */
export function dropChip(segs: readonly Seg[], index: number): Seg[] {
  const out = segs.filter((_, i) => i !== index);
  const merged: Seg[] = [];
  for (const s of out) { const last = merged[merged.length - 1]; if (last && last.kind === "text" && s.kind === "text") merged[merged.length - 1] = { kind: "text", text: last.text + s.text }; else merged.push(s); }
  return merged;
}

/** Add a chip at the end of the text. */
export const addChip = (value: string, ref: string): string => `${value}${value === "" || /\s$/.test(value) ? "" : " "}{{ ${ref} }}`;
