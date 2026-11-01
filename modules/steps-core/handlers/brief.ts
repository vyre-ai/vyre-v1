// The brief of an AI step (work baton, item 8): what an agent, or a model asked for one answer, is told about the work. Built by code from the step, the Run and what the Run already holds, never
// hand-joined, in a fixed order of short sections:
//   Goal         the step's instruction
//   Context      the Automation, what started this Run in one line, linked records by title and id, files by name, earlier steps' outputs by step name
//   Inputs       the mapped inputs as named fields
//   Deliverable  the output fields as a list (name, type, meaning) and a tiny example; an answer step also gets the schema its answer is checked against
//   Done means   the step's own checklist
//   Next         who reviews and who approves, by name
//   Rules        the time limit, what is held for approval, secrets by handle only
//   Finish       agent task only: the baton tools, and that the turn ends with one of them
// Nothing here reads the Vault, a key or an account, and a value that looks like a secret in the data the Run holds is shown as hidden: a brief is read by a model and kept in a thread.
import { sample } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

export const MAX_BRIEF_INPUT = 100_000;
const OUTPUT_CHARS = 1_500;
const OUTPUTS_TOTAL = 12_000;
const TRIGGER_CHARS = 400;
const SECRET_KEY = /(secret|password|passwd|authorization|cookie|token|api[-_]?key|credential|private[-_]?key)/i;
const SECRET_VALUE = /^(bearer\s+|sk-|key_|xox[a-z]-|ghp_|AKIA)/i;
const HIDDEN = "[hidden]";

/** A copy of data with anything that looks like a secret hidden, by field name and by shape. A handle (#Name) is not a secret and stays. */
export function scrub(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return SECRET_VALUE.test(v.trim()) ? HIDDEN : v;
  if (v === null || typeof v !== "object" || depth > 12) return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => scrub(x, depth + 1));
  const out: Obj = {};
  for (const [k, x] of Object.entries(v as Obj)) out[k] = SECRET_KEY.test(k) && typeof x === "string" && !x.startsWith("#") ? HIDDEN : scrub(x, depth + 1);
  return out;
}

const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}...`);
const compact = (v: unknown, n: number): string => cut(JSON.stringify(scrub(v)) ?? "", n);

// ---- what the Run already holds ----

const TITLE_KEYS = ["title", "name", "displayName", "label", "subject"];
/** The words a record or file is known by, from the fields the data already carries. */
function titleOf(o: Obj): string | undefined {
  const fields = isObj(o["fields"]) ? o["fields"] : {};
  for (const k of TITLE_KEYS) { const t = str(o[k]) ?? str(fields[k]); if (t) return cut(t, 100); }
  return undefined;
}

export interface Linked { records: Array<{ id: string; title?: string }>; files: Array<{ id: string; name?: string }> }
/** The records and files the Run has touched: every object in the data with a rec_ or fil_ id, by the title or name it carries. */
export function linkedIn(...sources: unknown[]): Linked {
  const records = new Map<string, string | undefined>();
  const files = new Map<string, string | undefined>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12 || v === null || typeof v !== "object" || records.size + files.size >= 60) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const o = v as Obj;
    const id = str(o["id"]), fileId = str(o["fileId"]);
    if (id && /^rec_[a-z0-9]+$/.test(id) && !records.get(id)) records.set(id, titleOf(o));
    else if (id && /^fil_[a-z0-9]+$/.test(id) && !files.get(id)) files.set(id, str(o["name"]) ?? str(o["fileName"]));
    if (fileId && /^fil_[a-z0-9]+$/.test(fileId) && !files.get(fileId)) files.set(fileId, str(o["name"]) ?? str(o["fileName"]));
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const s of sources) walk(s, 0);
  return { records: [...records].map(([id, title]) => ({ id, ...(title ? { title } : {}) })), files: [...files].map(([id, name]) => ({ id, ...(name ? { name } : {}) })) };
}

// ---- the deliverable, from the schema ----

function describe(s: JsonSchema | undefined): string {
  if (!s) return "any value";
  const t = Array.isArray(s.type) ? s.type.join(" or ") : s.type ?? (s.enum ? "value" : "any value");
  const bits: string[] = [t];
  if (Array.isArray(s.enum)) bits.push(`one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  if (typeof s.minimum === "number" || typeof s.maximum === "number") bits.push(`${s.minimum ?? ""} to ${s.maximum ?? ""}`.trim());
  if (t === "array" && s.items && !Array.isArray(s.items)) bits.push(`of ${describe(s.items as JsonSchema)}`);
  return bits.join(", ");
}

/** One line per field: name, required or optional, type, and the schema's own words about it. Nested objects list their fields as a.b. */
export function fieldLines(schema: JsonSchema, prefix = "", depth = 0): string[] {
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set(schema.required ?? []);
  const lines: string[] = [];
  for (const [name, p] of Object.entries(props).slice(0, 40)) {
    const label = `${prefix}${name}`;
    lines.push(`- ${label} (${required.has(name) ? "required" : "optional"}, ${describe(p)})${p.description ? `: ${one(p.description)}` : ""}`);
    if (p.type === "object" && p.properties && depth < 2) lines.push(...fieldLines(p, `${label}.`, depth + 1));
  }
  return lines;
}
const one = (s: string): string => cut(s.replace(/\s+/g, " ").trim(), 160);

// ---- the brief ----

export interface BriefInput {
  kind: "answer" | "task";
  goal: string;
  automation?: string | undefined;
  trigger?: unknown;
  outputs?: Readonly<Record<string, unknown>> | undefined;
  /** Other data the Run holds that may link records or files (the loop item). */
  also?: readonly unknown[] | undefined;
  inputs?: unknown;
  schema?: JsonSchema | undefined;
  doneMeans?: readonly string[] | undefined;
  /** Names of the people and agents who come next. */
  reviewer?: string | undefined;
  approver?: string | undefined;
  timeoutMinutes?: number | undefined;
}

const section = (title: string, body: string | string[]): string => {
  const text = Array.isArray(body) ? body.join("\n") : body;
  return text.trim() === "" ? "" : `## ${title}\n${text.trim()}`;
};

export function buildBrief(i: BriefInput): string {
  const parts: string[] = [section("Goal", i.goal)];

  const ctx: string[] = [];
  if (i.automation) ctx.push(`Automation: ${i.automation}`);
  if (i.trigger !== undefined && i.trigger !== null && !(isObj(i.trigger) && Object.keys(i.trigger).length === 0)) ctx.push(`Started by: ${compact(i.trigger, TRIGGER_CHARS)}`);
  const linked = linkedIn(i.trigger, i.outputs, ...(i.also ?? []));
  if (linked.records.length > 0) ctx.push(`Records: ${linked.records.slice(0, 20).map((r) => (r.title ? `${r.title} (${r.id})` : r.id)).join(", ")}`);
  if (linked.files.length > 0) ctx.push(`Files: ${linked.files.slice(0, 20).map((f) => (f.name ? `${f.name} (${f.id})` : f.id)).join(", ")}`);
  const earlier = Object.entries(i.outputs ?? {});
  if (earlier.length > 0) {
    let budget = OUTPUTS_TOTAL;
    ctx.push("Earlier steps:");
    for (const [name, out] of earlier.slice(-20)) {
      const line = `- ${name}: ${compact(out, Math.min(OUTPUT_CHARS, budget))}`;
      budget -= line.length;
      ctx.push(line);
      if (budget <= 0) { ctx.push("- (more steps ran before; their outputs are in the Run)"); break; }
    }
  }
  parts.push(section("Context", ctx));

  if (i.inputs !== undefined && i.inputs !== null) {
    const data = scrub(i.inputs);
    const lines = isObj(data) && Object.keys(data).length > 0
      ? Object.entries(data).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      : [JSON.stringify(data, null, 2)];
    const text = lines.join("\n");
    if (text.length > MAX_BRIEF_INPUT) throw new RangeError(`The input is over ${MAX_BRIEF_INPUT} characters.`);
    parts.push(section("Inputs", text));
  }

  if (i.schema) {
    const fields = fieldLines(i.schema);
    const lines: string[] = fields.length > 0 ? ["Fields:", ...fields] : [];
    let example = "";
    try { example = JSON.stringify(sample(i.schema)); } catch { /* a schema that cannot be sampled has no example */ }
    if (example) lines.push(`Example: ${example}`);
    if (i.kind === "answer") lines.push(`Answer with one JSON value only, no other text, that matches this JSON Schema:\n${JSON.stringify(i.schema)}`);
    else lines.push("Hand these in as the outputs of task_submit.");
    parts.push(section("Deliverable", lines));
  }

  if (i.doneMeans && i.doneMeans.length > 0) parts.push(section("Done means", i.doneMeans.slice(0, 20).map((d) => `- ${one(d)}`)));

  const next: string[] = [];
  if (i.reviewer) next.push(`${i.reviewer} reviews your work against Done means.`);
  if (i.approver) next.push(`${i.approver} approves it before anything is final.`);
  parts.push(section("Next", next));

  const rules: string[] = [];
  if (i.timeoutMinutes) rules.push(`Take at most ${i.timeoutMinutes} minutes.`);
  if (i.kind === "task") rules.push("Anything that leaves Vyre (an email, a text, a post, a payment) is held for approval. Say what is waiting and for whom.");
  rules.push("Use secrets by Vault handle only. Never write a secret value anywhere.");
  parts.push(section("Rules", rules));

  if (i.kind === "task") {
    parts.push(section("Finish", "End your turn with exactly one baton call: task_submit when the work is done (the outputs and a one-line summary), task_ask if only a person can tell you something, or task_block if something stops you. Your task section gives the taskId."));
  }
  return parts.filter((p) => p !== "").join("\n\n");
}
