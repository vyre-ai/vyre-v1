// What the Configure tab asks for. Pure functions, no React: a control for every property of a step's input schema, a form for every trigger, and a one-line summary of each that says
// "Not set up" when something the Automation cannot run without is missing. The tests walk the whole catalog (generated/registry.json) through these, so a step or trigger that has no form fails there.
import { cronSummary, deviceTimeZone, parseCron, scheduleWords, validTimeZone } from "./schedule.ts";

export const NOT_SET_UP = "Not set up";

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A value that counts as filled in: text with something in it, a number or flag, a list or object with something in it. A `{{ }}` template counts; it is filled when the run starts. */
export function present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (isRec(v)) return Object.keys(v).length > 0;
  return true;
}

export const humanize = (k: string): string => k.replace(/([A-Z])/g, " $1").replace(/[_.]+/g, " ").replace(/^./, (x) => x.toUpperCase()).trim();

// ---------------------------------------------------------------- schemas

/** Follow `$ref` into `defs` (the registry's $defs). A reference with no definition stays as it is and the control for it is a JSON box. Depth is capped, so a cycle ends. */
export function resolveSchema(schema: unknown, defs: Record<string, unknown> | undefined, depth = 0): unknown {
  if (depth > 6 || !isRec(schema)) return schema;
  const ref = schema["$ref"];
  if (typeof ref === "string") {
    const hit = defs?.[ref.replace(/^#\/\$defs\//, "")];
    return hit === undefined ? schema : resolveSchema(hit, defs, depth + 1);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "properties" && isRec(v)) {
      const props: Record<string, unknown> = {};
      for (const [name, p] of Object.entries(v)) props[name] = resolveSchema(p, defs, depth + 1);
      out[k] = props;
    } else if (k === "items") out[k] = resolveSchema(v, defs, depth + 1);
    else out[k] = v;
  }
  return out;
}

export function requiredOf(schema: unknown): string[] {
  return isRec(schema) && Array.isArray(schema["required"]) ? schema["required"].filter((x): x is string => typeof x === "string") : [];
}

// ---------------------------------------------------------------- step controls

export type ControlKind = "text" | "multiline" | "number" | "toggle" | "choice" | "list" | "json" | "who";
export interface Control {
  name: string;
  label: string;
  kind: ControlKind;
  required: boolean;
  options: string[];
  placeholder: string;
  hint: string;
  /** A sign-in or connection: the Account row covers it when there is one. */
  account: boolean;
  /** For a list: the items are numbers. */
  numeric: boolean;
}

const ACCOUNT = new Set(["connectionId", "mailboxId", "numberId", "connector"]);
const LONG = new Set(["body", "text", "prompt", "description", "message", "summary", "source", "html", "agenda", "content"]);

function typeName(prop: Record<string, unknown>): string {
  const raw = prop["type"];
  const name = Array.isArray(raw) ? raw.find((x) => x !== "null") : raw;
  return typeof name === "string" ? name : "";
}

function isWho(prop: Record<string, unknown>): boolean {
  const p = prop["properties"];
  if (!isRec(p) || !isRec(p["kind"]) || !isRec(p["id"])) return false;
  return Array.isArray(p["kind"]["enum"]) && p["kind"]["enum"].includes("person");
}

/** One control for each property of the schema, required ones first. Every property gets one: a type the form has no special control for gets a JSON box. */
export function controlsFor(schema: unknown): Control[] {
  if (!isRec(schema) || !isRec(schema["properties"])) return [];
  const required = new Set(requiredOf(schema));
  const out: Control[] = [];
  for (const [name, raw] of Object.entries(schema["properties"])) {
    const prop = isRec(raw) ? raw : {};
    const t = typeName(prop);
    const options = Array.isArray(prop["enum"]) ? prop["enum"].filter((x): x is string => typeof x === "string") : [];
    const examples = Array.isArray(prop["examples"]) ? prop["examples"] : [];
    const example = typeof examples[0] === "string" ? examples[0] : "";
    const description = typeof prop["description"] === "string" && prop["description"] !== "Any JSON value" ? prop["description"] : "";
    const items = isRec(prop["items"]) ? prop["items"] : {};
    const itemType = typeName(items);
    let kind: ControlKind = "json";
    let numeric = false;
    if (options.length > 0) kind = "choice";
    else if (isWho(prop)) kind = "who";
    else if (t === "string") kind = LONG.has(name) ? "multiline" : "text";
    else if (t === "integer" || t === "number") kind = "number";
    else if (t === "boolean") kind = "toggle";
    else if (t === "array" && (itemType === "string" || itemType === "integer" || itemType === "number") && !Array.isArray(items["enum"])) { kind = "list"; numeric = itemType !== "string"; }
    out.push({
      name, label: humanize(name), kind, required: required.has(name), options, account: ACCOUNT.has(name), numeric,
      placeholder: example || (kind === "list" ? "One per line or separated by commas" : kind === "json" ? "JSON" : ""),
      hint: description,
    });
  }
  return [...out.filter((c) => c.required), ...out.filter((c) => !c.required)];
}

/** The text a control shows for the value the step holds. */
export function controlText(c: Control, v: unknown): string {
  if (v === undefined || v === null) return "";
  if (c.kind === "list") return Array.isArray(v) ? v.map((x) => String(x)).join("\n") : String(v);
  if (c.kind === "json" || c.kind === "who") return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
}

/** What typing `text` into a control writes. `undefined` removes the key. A problem keeps the old value and says why. */
export function controlValue(c: Control, text: string): { value: unknown } | { problem: string } {
  const t = text.trim();
  if (c.kind === "text" || c.kind === "multiline" || c.kind === "choice") return { value: text === "" ? undefined : text };
  if (c.kind === "toggle") return { value: t === "" ? undefined : t === "true" };
  if (c.kind === "number") {
    if (t === "") return { value: undefined };
    if (t.includes("{{")) return { value: t };
    const n = Number(t);
    return Number.isFinite(n) ? { value: n } : { problem: `${c.label} must be a number.` };
  }
  if (c.kind === "list") {
    const parts = t.split(/[\n,]/).map((x) => x.trim()).filter((x) => x !== "");
    if (parts.length === 0) return { value: undefined };
    if (!c.numeric) return { value: parts };
    const nums = parts.map(Number);
    return nums.every((n) => Number.isFinite(n)) ? { value: nums } : { problem: `${c.label} must be numbers.` };
  }
  if (t === "") return { value: undefined };
  try { return { value: JSON.parse(t) as unknown }; } catch { return { problem: "That is not valid JSON." }; }
}

export function writeControl(input: Record<string, unknown>, c: Control, text: string): { input: Record<string, unknown> } | { problem: string } {
  const out = controlValue(c, text);
  if ("problem" in out) return out;
  const next = { ...input };
  if (out.value === undefined) delete next[c.name];
  else next[c.name] = out.value;
  return { input: next };
}

// ---------------------------------------------------------------- what a step is missing

/** The extra fields the server asks for beyond the schema (a mailbox to send from, a number to text from, a connection for a request). */
const ALSO_REQUIRED: Record<string, readonly string[]> = {
  send_email: ["mailboxId"],
  send_sms: ["numberId"],
  connector_request: ["connector", "action", "connectionId"],
};
/** Lanes and paths live on the step, not in its input. */
const ON_THE_STEP = new Set(["paths", "branches"]);

export function missingFor(key: string, input: Record<string, unknown>, required: readonly string[], branches: number): string[] {
  const out: string[] = [];
  for (const name of [...required, ...(ALSO_REQUIRED[key] ?? [])]) {
    if (out.includes(name)) continue;
    if (ON_THE_STEP.has(name)) { if (branches === 0) out.push(name); continue; }
    if (!present(input[name])) out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------- triggers

export type TriggerFieldKind = "text" | "choice" | "list" | "json" | "pick";
export type Pick = "types" | "forms" | "journeys";
export interface TriggerField {
  name: string;
  label: string;
  kind: TriggerFieldKind;
  /** The key holds it: `filter` narrows which events start a run, `config` is the trigger's own setting. */
  in: "filter" | "config";
  required?: boolean;
  options?: readonly string[];
  /** A pick is chosen from a list the app can read; when the list cannot be read it is a text box. */
  from?: Pick;
  placeholder?: string;
  help?: string;
}
export interface TriggerSpec { fields: readonly TriggerField[]; note?: string }

const NAME: TriggerField = { name: "label", label: "Name", kind: "text", in: "config", placeholder: "Shown on the card and the tab", help: "Optional. Tell triggers of one kind apart." };
const f = (name: string, label: string, extra: Partial<TriggerField> = {}): TriggerField => ({ name, label, kind: "text", in: "filter", ...extra });

/** Every trigger in the catalog has an entry; the test fails when one is added without. The fields are the keys the trigger consumer matches (modules/automations/handlers/triggers.ts). */
export const TRIGGER_SPECS: Record<string, TriggerSpec> = {
  record_change: { fields: [
    f("type", "Record type", { kind: "pick", from: "types", required: true, placeholder: "contact" }),
    f("op", "When it is", { kind: "choice", options: ["created", "updated", "deleted"], help: "Leave empty for any change." }),
    f("fields", "Only when these fields change", { kind: "list", placeholder: "One field name per line" }),
    f("where", "Only when values match", { kind: "json", placeholder: '{"status":"new"}', help: "Optional. Field values the record must have." }),
  ] },
  schedule: { fields: [] },
  webhook: { fields: [], note: "Starts when something sends a request to this Automation's address. The address is on the Settings tab once it is on." },
  form_submit: { fields: [f("formId", "Form", { kind: "pick", from: "forms", help: "Leave empty for any form." })] },
  email_received: { fields: [f("mailboxId", "Mailbox", { placeholder: "mbx_...", help: "Leave empty for any mailbox." }), f("from", "From", { placeholder: "name@example.com", help: "Leave empty for anyone." })] },
  chat_message: { fields: [f("threadId", "Chat", { placeholder: "thr_...", help: "Leave empty for any chat." })] },
  spreadsheet_row: { fields: [
    f("fileId", "Spreadsheet", { required: true, placeholder: "fil_..." }),
    f("sheet", "Sheet", { help: "Leave empty for any sheet." }),
    f("op", "When a row is", { kind: "choice", options: ["added", "changed"], help: "Leave empty for either." }),
    f("columns", "Only when these columns change", { kind: "list", placeholder: "One column per line" }),
  ] },
  ci_check: { fields: [
    f("repo", "Repository", { placeholder: "owner/name" }),
    f("branch", "Branch"),
    f("conclusion", "Result", { kind: "choice", options: ["success", "failure", "cancelled", "neutral"], help: "Leave empty for any result." }),
  ] },
  meeting_transcript_ready: { fields: [f("source", "Meeting source", { help: "Leave empty for any source." })] },
  journey_stage_entered: { fields: [f("journeyId", "Journey", { kind: "pick", from: "journeys", help: "Leave empty for any Journey." }), f("stage", "Stage", { help: "Leave empty for any stage." })] },
  journey_stage_left: { fields: [f("journeyId", "Journey", { kind: "pick", from: "journeys", help: "Leave empty for any Journey." }), f("stage", "Stage", { help: "Leave empty for any stage." })] },
  campaign_reply: { fields: [f("campaignId", "Campaign", { placeholder: "cmp_...", help: "Leave empty for any campaign." })] },
  button: { fields: [], note: "Starts when someone presses its button. Give it a name so people know what it does." },
  manual: { fields: [], note: "Starts when you press Run now at the top of the page." },
};

export interface TriggerLike { key: string; config?: Record<string, unknown> | undefined; filter?: unknown }

export function specOf(key: string): TriggerSpec {
  return TRIGGER_SPECS[key] ?? { fields: [] };
}

/** Every field a trigger form shows, the Name first. A schedule's own picker covers when it runs. */
export function fieldsOfTrigger(key: string): TriggerField[] {
  return [NAME, ...specOf(key).fields];
}

export function triggerValue(t: TriggerLike, field: TriggerField): unknown {
  if (field.in === "config") return t.config?.[field.name];
  return isRec(t.filter) ? t.filter[field.name] : undefined;
}

export function triggerText(field: TriggerField, v: unknown): string {
  if (v === undefined || v === null) return "";
  if (field.kind === "list") return Array.isArray(v) ? v.map(String).join("\n") : String(v);
  if (field.kind === "json") return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return typeof v === "string" ? v : String(v);
}

/** Write one field of a trigger. Empty removes it, and an empty filter is removed with it so "any event" stays a trigger with no filter. */
export function writeTriggerField<T extends TriggerLike>(t: T, field: TriggerField, text: string): T | { problem: string } {
  let value: unknown;
  const s = text.trim();
  if (field.kind === "list") { const parts = s.split(/[\n,]/).map((x) => x.trim()).filter((x) => x !== ""); value = parts.length > 0 ? parts : undefined; }
  else if (field.kind === "json") {
    if (s === "") value = undefined;
    else {
      try { value = JSON.parse(s) as unknown; } catch { return { problem: "That is not valid JSON." }; }
      if (!isRec(value)) return { problem: "Write it as an object, such as {\"status\":\"new\"}." };
    }
  } else value = s === "" ? undefined : s;
  if (field.in === "config") {
    const config = { ...(t.config ?? {}) };
    if (value === undefined) delete config[field.name]; else config[field.name] = value;
    const next = { ...t } as T;
    if (Object.keys(config).length === 0) delete (next as TriggerLike).config; else (next as TriggerLike).config = config;
    return next;
  }
  const filter: Record<string, unknown> = isRec(t.filter) ? { ...t.filter } : {};
  if (value === undefined) delete filter[field.name]; else filter[field.name] = value;
  const next = { ...t } as T;
  if (Object.keys(filter).length === 0) delete (next as TriggerLike).filter; else (next as TriggerLike).filter = filter;
  return next;
}

export function triggerMissing(t: TriggerLike): string[] {
  if (t.key === "schedule") {
    const cron = t.config?.["cron"];
    return typeof cron === "string" && parseCron(cron) ? [] : ["cron"];
  }
  return specOf(t.key).fields.filter((x) => x.required && !present(triggerValue(t, x))).map((x) => x.name);
}

export interface RefNames { type?(key: string): string; form?(id: string): string; journey?(id: string): string }

const OPS: Record<string, string> = { created: "is created", updated: "is updated", deleted: "is deleted" };

/** The second line of a trigger: what it does, from what it holds. `ok` is false when something it needs is missing, and the card paints the line amber. */
export function triggerSummary(t: TriggerLike, names: RefNames = {}, zone?: string): { text: string; ok: boolean } {
  const bad = { text: NOT_SET_UP, ok: false };
  if (triggerMissing(t).length > 0) return bad;
  const flt = isRec(t.filter) ? t.filter : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  switch (t.key) {
    case "schedule": {
      const tz = typeof t.config?.["timezone"] === "string" && validTimeZone(t.config["timezone"]) ? t.config["timezone"] : (zone ?? deviceTimeZone());
      return { text: scheduleWords(String(t.config?.["cron"]), tz) ?? bad.text, ok: true };
    }
    case "manual": return { text: "Starts when you press Run now", ok: true };
    case "button": return { text: "Starts when someone presses it", ok: true };
    case "webhook": return { text: "Starts on a web request", ok: true };
    case "record_change": {
      const type = str(flt["type"]);
      const label = names.type?.(type) ?? type;
      const op = str(flt["op"]);
      const fields = list(flt["fields"]);
      const where = flt["where"];
      const extra = fields.length > 0 ? `, when ${fields.join(", ")} change${fields.length === 1 ? "s" : ""}` : typeof where === "string" && where ? `, only when ${where}` : isRec(where) && Object.keys(where).length > 0 ? `, only when ${Object.entries(where).map(([k, v]) => `${k} is ${String(v)}`).join(" and ")}` : "";
      return { text: `A ${label} ${op ? OPS[op] ?? "changes" : "changes"}${extra}`, ok: true };
    }
    case "form_submit": { const id = str(flt["formId"]); return { text: id ? `Form: ${names.form?.(id) ?? id}` : "Any form is submitted", ok: true }; }
    case "email_received": {
      const from = str(flt["from"]), mailbox = str(flt["mailboxId"]);
      return { text: from ? `Email from ${from}` : mailbox ? `Email to ${mailbox}` : "Any email arrives", ok: true };
    }
    case "chat_message": return { text: str(flt["threadId"]) ? `A message in ${str(flt["threadId"])}` : "Any chat message", ok: true };
    case "spreadsheet_row": {
      const op = str(flt["op"]);
      return { text: `A row is ${op || "added or changed"}${str(flt["sheet"]) ? ` in ${str(flt["sheet"])}` : ""}`, ok: true };
    }
    case "ci_check": {
      const bits = [str(flt["repo"]), str(flt["branch"])].filter((x) => x !== "").join(" on ");
      const result = str(flt["conclusion"]);
      return { text: `A check${result ? ` ${result === "success" ? "passes" : result === "failure" ? "fails" : `is ${result}`}` : " finishes"}${bits ? ` for ${bits}` : ""}`, ok: true };
    }
    case "meeting_transcript_ready": return { text: str(flt["source"]) ? `A transcript from ${str(flt["source"])}` : "Any transcript is ready", ok: true };
    case "journey_stage_entered":
    case "journey_stage_left": {
      const j = str(flt["journeyId"]), stage = str(flt["stage"]);
      const verb = t.key === "journey_stage_entered" ? "enters" : "leaves";
      return { text: `${j ? `${names.journey?.(j) ?? j}: ` : ""}A record ${verb} ${stage ? stage : "a stage"}`, ok: true };
    }
    case "campaign_reply": return { text: str(flt["campaignId"]) ? `A reply to ${str(flt["campaignId"])}` : "Any campaign reply", ok: true };
    default: return { text: "Starts a run", ok: true };
  }
}

export { cronSummary };
