// The approval card of a chat (rc.8): when a turn parks on a hold the person answers it in the chat, with what the agent wants to do, a short excerpt, and Allow or Deny. This file is the words,
// without a renderer. The hold is a task of kind approve (tasks.get); its first block carries { act, cap, input }; the actions are approve and reject.
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

export interface Held { cap: string; act: string; input: Obj }

/** The capability and input a hold's task carries in its first block, or an empty hold when it carries none. */
export function heldOf(blocks: readonly { type: string; data: unknown }[]): Held {
  const d = obj(blocks[0]?.data);
  return { cap: text(d["cap"]), act: text(d["act"]), input: obj(d["input"]) };
}

const WANTS: Record<string, string> = {
  "files.write": "edit", "files.create": "create", "files.delete": "delete", "files.move": "move", "files.rename": "rename", "files.folder.create": "create the folder",
  "records.update": "change", "records.create": "add a record", "records.delete": "delete",
  "mail.send": "send an email", "inbox.reply": "send a reply", "twilio.send": "send a text", "telephony.sms.send": "send a text",
  "stripe.refund.create": "refund a payment", "calendar.create_event": "put an event on the calendar", "calendar.update_event": "change an event", "calendar.delete_event": "delete an event",
  "git.push": "push your changes", "git.commit": "save your changes to the repository", "sites.promote": "put the site live",
};

/** The phrase after "<Agent> wants to": a known step reads in plain words, any other is its name spelled out. */
export function wantsPhrase(cap: string, subject?: string): string {
  const base = WANTS[cap] ?? (cap === "" ? "do a step" : `run ${cap.replace(/[._]+/g, " ")}`);
  const fileStep = cap.startsWith("files.") && cap !== "files.folder.create";
  return subject && (fileStep || cap === "records.update" || cap === "records.delete") ? `${base} ${subject}` : base;
}

/** The first line of the card: who wants what. */
export function wantsLine(agent: string, cap: string, subject?: string): string {
  return `${agent} wants to ${wantsPhrase(cap, subject)}`;
}

const SKIP = new Set(["idempotencyKey", "reason", "baseVersion", "as"]);
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const label = (k: string): string => {
  const w = k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** A few lines of what the step carries: the new text of a file, a mail's subject and body, or the plain fields of any other. Ids and keys are left out; nothing is shown that the person cannot read. */
export function excerptLines(input: Obj, max = 5): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  const content = obj(input["content"]);
  const body = text(content["text"]);
  if (body) out.push({ label: "New text", text: cut(body.split("\n").filter((l) => l.trim() !== "").slice(0, 4).join("\n"), 320) });
  for (const [k, v] of Object.entries(input)) {
    if (out.length >= max) break;
    if (SKIP.has(k) || k === "content" || /Id$/.test(k) || k === "id") continue;
    const t = Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : text(v);
    if (t) out.push({ label: label(k), text: cut(t, k === "body" || k === "text" ? 320 : 120) });
  }
  return out;
}

/** The one-line row an answered card collapses to: "Allowed · edit Q4 pricing.docx". */
export function doneLine(outcome: "allowed" | "denied", cap: string, subject?: string): string {
  return `${outcome === "allowed" ? "Allowed" : "Denied"} · ${wantsPhrase(cap, subject)}`;
}

/** What goes back to the agent with a Deny: the person's words, or a plain default (a send back needs a note). */
export const denyNote = (reason: string): string => (reason.trim() === "" ? "Not allowed." : reason.trim());

/** The outcome of a task that has already ended, read from its state. */
export const outcomeOf = (state: string): "allowed" | "denied" | null => (state === "done" ? "allowed" : state === "canceled" ? "denied" : null);

export interface DiffLine { kind: "add" | "del"; text: string }

/** A compact diff of an edit: the lines taken out and the lines put in, in order, with the unchanged lines left out. At most `max` lines show; `more` counts the rest. Long files are compared on their first 400 lines. */
export function diffLines(before: string, after: string, max = 8): { lines: DiffLine[]; more: number } {
  const a = before.split("\n").slice(0, 400);
  const b = after.split("\n").slice(0, 400);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
    else if (i < a.length && (j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) { if (a[i]!.trim() !== "") out.push({ kind: "del", text: a[i]! }); i++; }
    else { if (b[j]!.trim() !== "") out.push({ kind: "add", text: b[j]! }); j++; }
  }
  return { lines: out.slice(0, max), more: Math.max(0, out.length - max) };
}
