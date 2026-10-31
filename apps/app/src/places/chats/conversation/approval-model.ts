// The approval card of a chat (rc.8): when a turn parks on a hold the person answers it in the chat, with what the agent wants to do, a short excerpt, and Allow or Deny. This file is the words,
// without a renderer. The hold is a task of kind approve (tasks.get); its first block carries { act, cap, input }; the actions are approve and reject.
import { appName, hubById } from "../../../../../../lib/mcp-hubs.ts";
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
  "engine.mcp.call": "use an outside tool", "engine.mcp.read": "read from an outside tool",
  "files.write": "edit", "files.create": "create", "files.delete": "delete", "files.move": "move", "files.rename": "rename", "files.folder.create": "create the folder",
  "records.update": "change", "records.create": "add a record", "records.delete": "delete",
  "mail.send": "send an email", "inbox.reply": "send a reply", "twilio.send": "send a text", "telephony.sms.send": "send a text",
  "stripe.refund.create": "refund a payment", "calendar.create_event": "put an event on the calendar", "calendar.update_event": "change an event", "calendar.delete_event": "delete an event",
  "git.push": "push your changes", "git.commit": "save your changes to the repository", "sites.promote": "put the site live",
};

/** A step with no entry of its own, in plain words: "tasks.create" is "create a task", "calendar.add_guest" is "add a guest on calendar", never the capability's own name. */
function capPhrase(cap: string): string {
  const parts = cap.split(".").filter(Boolean);
  const action = (parts[parts.length - 1] ?? cap).replace(/[_-]+/g, " ");
  const scope = parts.length > 1 ? parts[0]!.replace(/[_-]+/g, " ") : "";
  const single = scope.replace(/ies$/, "y").replace(/s$/, "");
  const [verb, ...rest] = action.split(" ");
  if (verb && VERBS.has(verb) && rest.length === 0 && single) return verbPhrase(`${verb} ${single}`);
  const phrase = verbPhrase(action);
  return scope ? `${phrase} in ${scope}` : phrase;
}

/** The phrase after "<Agent> wants to": a known step reads in plain words, any other is its name spelled out. */
export function wantsPhrase(cap: string, subject?: string, input?: Obj): string {
  const outside = cap === "engine.mcp.call" && input ? outsideTool(input) : null;
  if (outside) return outside.phrase;
  const base = WANTS[cap] ?? (cap === "" ? "do a step" : capPhrase(cap));
  const fileStep = cap.startsWith("files.") && cap !== "files.folder.create";
  return subject && (fileStep || cap === "records.update" || cap === "records.delete") ? `${base} ${subject}` : base;
}

/** The first line of the card: who wants what. */
export function wantsLine(agent: string, cap: string, subject?: string, input?: Obj): string {
  return `${agent} wants to ${wantsPhrase(cap, subject, input)}`;
}

const VERBS = new Set(["send", "create", "add", "update", "delete", "remove", "post", "archive", "edit", "change", "set", "invite", "share", "schedule", "book", "cancel", "close", "open", "reply", "forward", "upload", "move", "rename", "assign", "complete", "resolve", "mark", "merge", "publish", "write", "make", "start", "stop", "approve", "reject", "submit", "save", "log", "fill", "attach", "replace", "pause", "resume", "enable", "disable", "connect", "disconnect", "transfer", "refund", "charge", "tag", "label", "star", "pin", "unpin", "react", "comment", "sync"]);
const aOrAn = (w: string): string => (/^[aeiou]/i.test(w) ? "an" : "a");

/** Turns the words of a tool or capability name into a short verb phrase a person reads: "send message" becomes "send a message", "create contact" becomes "create a contact". A plural or a phrase that already has its own article is left as it is; a name that does not start with a verb is shown as its words. */
export function verbPhrase(words: string): string {
  const w = words.trim().replace(/\s+/g, " ").toLowerCase();
  const [verb, ...rest] = w.split(" ");
  if (!verb || rest.length === 0 || !VERBS.has(verb)) return w;
  const noun = rest.join(" ");
  if (/^(a|an|the|all|my|your|this|that|any|some)\b/.test(noun) || /s$/.test(rest[rest.length - 1]!) || /\b(to|in|on|for|from|with|of)\b/.test(noun)) return `${verb} ${noun}`;
  return `${verb} ${aOrAn(noun)} ${noun}`;
}

/** A change made through an outside tool server: "send message in Slack" for a hub tool (the hub names the app in the tool), the tool's own words for any other server. */
function outsideTool(input: Obj): { phrase: string; hub?: string; fields: Obj } | null {
  const tool = text(input["tool"]);
  if (!tool) return null;
  const hub = hubById(text(input["server"]));
  const words = verbPhrase((hub ? tool.replace(/^[A-Za-z0-9]+[_-]/, "") : tool).replace(/[_-]+/g, " "));
  return { phrase: hub ? `${words} in ${appName(hub.appOf(tool))}` : words, ...(hub ? { hub: hub.name } : {}), fields: obj(input["input"]) };
}

const SKIP = new Set(["idempotencyKey", "reason", "baseVersion", "as"]);
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const label = (k: string): string => {
  const w = k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** A few lines of what the step carries: the new text of a file, a mail's subject and body, or the plain fields of any other. Ids and keys are left out; nothing is shown that the person cannot read. */
export function excerptLines(input: Obj, max = 5, cap?: string): Array<{ label: string; text: string }> {
  const outside = cap === "engine.mcp.call" ? outsideTool(input) : null;
  if (outside) {
    const lines = excerptLines(outside.fields, outside.hub ? max - 1 : max);
    return outside.hub ? [...lines, { label: "Runs through", text: outside.hub }] : lines;
  }
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
export function doneLine(outcome: "allowed" | "denied", cap: string, subject?: string, input?: Obj): string {
  return `${outcome === "allowed" ? "Allowed" : "Denied"} · ${wantsPhrase(cap, subject, input)}`;
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
