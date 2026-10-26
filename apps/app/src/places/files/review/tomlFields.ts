// The fields of agent.toml as the Form view shows them (vyre-v1.html FORM and LBL): the groups in the prototype's order, each key with its label and the kind of control it gets, and the small readers and
// writers the form needs on top of the line reader in model.ts: the tables of a file with the line each starts on, a value as the form shows it, and a key that is not in the file yet written into its table.
import { MODEL_CHOICES, formValue, parseToml, setTomlValue, tomlKind } from "./model.ts";
import type { Choice, TomlEntry } from "./model.ts";

export type FieldKind = "text" | "number" | "bool" | "list" | "enum" | "owner" | "model" | "models";

export interface FormField {
  key: string;
  label: string;
  kind: FieldKind;
  /** The picks of an enum, in menu order. */
  choices?: readonly Choice[];
}

export interface FormGroup {
  title: string;
  /** The table name in agent.toml ("identity", "approvals.rule"). */
  section: string;
  fields: readonly FormField[];
  /** A list of tables ([[routines]]): one block of fields per table. */
  multi?: boolean;
  /** Shown even when the file has no such table yet (its fields read Not set). */
  always?: boolean;
}

const pick = (...pairs: readonly (readonly [string, string])[]): Choice[] => pairs.map(([id, label]) => ({ id, label }));
const text = (key: string, label: string): FormField => ({ key, label, kind: "text" });
const num = (key: string, label: string): FormField => ({ key, label, kind: "number" });
const list = (key: string, label: string): FormField => ({ key, label, kind: "list" });
const flag = (key: string, label: string): FormField => ({ key, label, kind: "bool" });
const choose = (key: string, label: string, choices: readonly Choice[]): FormField => ({ key, label, kind: "enum", choices });

const WHOSE = pick(["owner", "The owner"], ["person", "A named person"], ["space_key", "A shared key"]);

export const FORM_GROUPS: readonly FormGroup[] = [
  { title: "Identity", section: "identity", always: true, fields: [
    text("id", "ID"), text("name", "Name"), text("handle", "Handle"), text("description", "Description"),
    { key: "owner", label: "Owner", kind: "owner" },
    choose("status", "Status", pick(["active", "Active"], ["paused", "Paused"], ["archived", "Archived"])),
  ] },
  { title: "Model", section: "model", always: true, fields: [
    { key: "primary", label: "Primary", kind: "model" }, { key: "fallback", label: "Fallback", kind: "models" },
    choose("effort", "Effort", pick(["low", "Quick"], ["medium", "Balanced"], ["high", "Thorough"])), num("max_output_tokens", "Max output tokens"),
  ] },
  { title: "Whose AI account", section: "runs_on", always: true, fields: [
    choose("mode", "Mode", pick(["asker", "Whoever asks"], ["person", "A named person"], ["space_key", "A shared key"])),
    choose("scheduled_runs_as", "Scheduled runs pay as", WHOSE),
    choose("on_account_missing", "If the account is missing", pick(["pause_and_notify", "Pause and tell the owner"], ["fail", "Fail the run"])),
  ] },
  { title: "Tools", section: "tools", fields: [list("allow", "Allowed"), list("deny", "Denied"), list("mcp", "Tool servers")] },
  { title: "Permissions", section: "permissions", fields: [
    choose("default", "Anything not listed", pick(["ask", "Ask first"], ["allow_listed", "Only what is listed"], ["deny", "Refuse"])),
    list("file_scope", "May read"), list("write_scope", "May write"),
    choose("network", "Network", pick(["none", "None"], ["allow_listed", "Listed sites only"], ["open", "Anywhere"])),
  ] },
  { title: "Approvals", section: "approvals.rule", multi: true, fields: [
    text("action", "Action"), choose("require", "Needs", pick(["none", "Nothing"], ["reviewer", "A reviewer"], ["approver", "An approver"], ["both", "Reviewer and approver"])),
    text("approver", "Approver"), text("reviewer", "Reviewer"), num("timeout_hours", "Timeout (hours)"),
    choose("on_timeout", "On timeout", pick(["hold", "Hold it"], ["cancel", "Cancel it"], ["escalate", "Ask someone else"])),
  ] },
  { title: "Vault", section: "vault", fields: [list("keys", "Key names"), choose("request_new", "New key requests", pick(["ask_owner", "Ask the owner"], ["deny", "Refuse"]))] },
  { title: "Limits", section: "limits", fields: [
    num("max_turns_per_run", "Turns per run"), num("max_run_minutes", "Minutes per run"), num("spend_per_run_usd", "Spend per run (USD)"), num("spend_per_day_usd", "Spend per day (USD)"),
    num("spend_per_month_usd", "Spend per month (USD)"), num("max_concurrent_runs", "Runs at once"),
    choose("on_limit", "At a limit", pick(["stop_and_notify", "Stop and tell the owner"], ["pause_agent", "Pause the agent"])),
  ] },
  { title: "Memory", section: "memory", fields: [
    flag("enabled", "On"), choose("auto_capture", "New facts", pick(["off", "Off"], ["propose", "Propose them"], ["write", "Write directly"])),
    choose("review", "Review", pick(["never", "Never"], ["weekly", "Weekly"], ["monthly", "Monthly"])), num("retention_days", "Keep for (days)"), list("share_read", "Shared with"),
  ] },
  { title: "Computer", section: "computer", fields: [
    flag("enabled", "On"), choose("size", "Size", pick(["small", "Small"], ["medium", "Medium"], ["large", "Large"])), flag("persistent", "Keeps its disk"), flag("browser", "Browser"),
    num("idle_stop_minutes", "Stops when idle (min)"), choose("screen_share", "Screen share", pick(["off", "Off"], ["ask", "Ask each time"], ["allow", "Allowed"])), list("allowed_apps", "Apps"),
  ] },
  { title: "Routines", section: "routines", multi: true, fields: [
    text("id", "ID"), text("prompt", "Prompt file"), text("cron", "Schedule"), text("timezone", "Time zone"), flag("enabled", "On"),
  ] },
  { title: "Watchers", section: "watchers", multi: true, fields: [
    text("id", "ID"), choose("on", "On", pick(["event", "An event"], ["file", "A file"], ["webhook", "A webhook"], ["interval", "On a timer"])), text("source", "Source"), text("prompt", "Prompt file"),
    num("debounce_seconds", "Wait (s)"), flag("enabled", "On"),
  ] },
  { title: "Handoff", section: "handoff", fields: [list("can_message", "May message"), list("can_delegate", "May delegate to"), list("accepts_from", "Accepts from")] },
  { title: "Logging", section: "logging", fields: [choose("level", "Level", pick(["error", "Errors only"], ["info", "Normal"], ["debug", "Detailed"])), num("keep_days", "Keep (days)"), list("redact", "Mask")] },
];

/** A table of the file: [name] or one of the [[name]] blocks, with the line its header is on and the keys under it. */
export interface TomlTable {
  /** "identity", "approvals.rule" (a [[...]] header loses its brackets). */
  name: string;
  /** 1-based line of the header; 0 for the keys above the first header. */
  line: number;
  /** The keys under it, in file order. */
  entries: TomlEntry[];
}

/** The tables of a file in order, repeated [[x]] blocks as separate tables. The line reader (parseToml) merges them by name, so the header lines are found here and each key goes to the last header above it. */
export function tomlTables(source: string): TomlTable[] {
  const tables: TomlTable[] = [{ name: "", line: 0, entries: [] }];
  const lines = source.split("\n");
  const found = parseToml(source);
  // The second and later lines of a list that runs over several lines are not headers, even when one reads like [x].
  const inside = new Set<number>();
  for (const e of found) for (let n = e.line + 1; n <= e.end; n++) inside.add(n);
  lines.forEach((raw, i) => {
    if (inside.has(i + 1)) return;
    const m = /^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(raw);
    if (m) tables.push({ name: (m[1] ?? "").trim(), line: i + 1, entries: [] });
  });
  for (const e of found) {
    let at = 0;
    for (let i = 0; i < tables.length; i++) if ((tables[i]?.line ?? 0) <= e.line) at = i;
    tables[at]?.entries.push(e);
  }
  return tables;
}

/** The table of a group at an index (0 for a single table). */
export function tablesNamed(tables: readonly TomlTable[], name: string): TomlTable[] {
  return tables.filter((t) => t.name === name);
}

/** Keys of a table that the form has no field for, so they still show (an unknown key warns in the lint, the form never hides it). */
export function extraEntries(table: TomlTable, group: FormGroup): TomlEntry[] {
  const known = new Set(group.fields.map((f) => f.key));
  return table.entries.filter((e) => !known.has(e.key));
}

/** The items of a one-line list, unquoted: ["a", "b"] gives a and b. */
export function listItems(raw: string): string[] {
  const v = raw.trim();
  if (!v.startsWith("[")) return [];
  const out: string[] = [];
  for (const m of v.matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push((m[1] ?? "").replaceAll('\\"', '"'));
  return out;
}

/** A list as the line writes it. */
export function listRaw(items: readonly string[]): string {
  return `[${items.map((x) => `"${x.replaceAll('"', '\\"')}"`).join(", ")}]`;
}

/** The text of a list field: the items as one comma line. */
export function listText(raw: string): string {
  return listItems(raw).join(", ");
}

/** What a typed comma line becomes: the items, trimmed, none empty. */
export function listFromText(value: string): string[] {
  return value.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
}

/** What a number field accepts. */
export function isNumberText(v: string): boolean {
  return /^-?\d[\d_]*(\.\d+)?$/.test(v.trim());
}

/** The value of a field as the form shows it, "" when the key is not in the file. */
export function fieldText(field: FormField, entry: TomlEntry | undefined): string {
  if (!entry) return "";
  if (field.kind === "list") return listText(entry.raw);
  return formValue(entry.raw);
}

/** What the line holds after the form writes a typed value: a string gets its quotes, a number and a switch stay bare, a list is written item by item. */
export function rawFor(field: FormField, value: string, entry?: TomlEntry): string {
  if (field.kind === "list") return listRaw(listFromText(value));
  if (field.kind === "number") return value.trim();
  if (field.kind === "bool") return value.trim() === "true" ? "true" : "false";
  // An existing bare value of another kind stays as the person wrote it only when it still reads the same.
  if (entry && tomlKind(entry.raw) === "other" && value === formValue(entry.raw)) return entry.raw.trim();
  return `"${value.replaceAll('"', '\\"')}"`;
}

/** The label of a pick: the choice's words, or the stored id when it is not one of the picks. */
export function pickLabel(choices: readonly Choice[], id: string): string {
  return choices.find((c) => c.id === id)?.label ?? id;
}

/** The words of a model id. */
export function modelLabel(id: string): string {
  return pickLabel(MODEL_CHOICES, id);
}

/**
 * Write a key that is not in the file yet: under the last key of its table (or right under the header of an empty one), or, when the file has no such table, as a new table at the end.
 * A key in a [[x]] block goes into the block at `table`, so the others stay as they are.
 */
export function addTomlKey(source: string, table: TomlTable | undefined, section: string, key: string, raw: string): string {
  const lines = source.split("\n");
  const row = `${key} = ${raw}`;
  if (table) {
    const last = table.entries[table.entries.length - 1];
    const after = last ? last.end : table.line;
    lines.splice(after, 0, row);
    return lines.join("\n");
  }
  while (lines.length > 0 && (lines[lines.length - 1] ?? "") === "") lines.pop();
  return [...lines, "", `[${section}]`, row, ""].join("\n");
}

/** The text after a field gets a value: its own line is rewritten, or, when the key is not in the file yet, it is added to its table. Nothing else in the file changes. */
export function writeField(source: string, field: FormField, entry: TomlEntry | undefined, table: TomlTable | undefined, section: string, raw: string): string {
  return entry ? setTomlValue(source, entry, raw) : addTomlKey(source, table, section, field.key, raw);
}
