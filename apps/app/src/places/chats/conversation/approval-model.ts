// The approval card of a chat (rc.8): when a turn parks on a hold the person answers it in the chat, with what the agent wants to do, a short excerpt, and Allow or Deny. This file is the words,
// without a renderer. The hold is a task of kind approve (tasks.get); its first block carries { act, cap, input }; the actions are approve and reject.
import { appName, hubById } from "../../../../../../lib/mcp-hubs.ts";
import type { Outward } from "../../../../../../lib/outward.ts";
import { WANTS, capPhrase, verbPhrase, wantsFromInput } from "../../../../../../lib/hold-words.ts";
export { verbPhrase };
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

export interface Held { /** the held message in a person's words, when the Gate wrote it (lib/outward.ts) */ outward?: Outward; holdId?: string; cap: string; act: string; input: Obj; /** An outside agent asked the person (docs/ask-the-person.md): what happens, in the capability's own words. */ what?: string; /** a plain yes or no from an agent of a teammate (lane l-agentdm): nothing runs as the reader */ plain?: true; detail?: string }

/** The capability and input a hold's task carries in its first block, or an empty hold when it carries none. */
export function heldOf(blocks: readonly { type: string; data: unknown }[]): Held {
  const d = obj(blocks[0]?.data);
  const what = text(obj(d["ask"])["what"]);
  // an agent asking a teammate in their direct chat to approve something (lane l-agentdm): a plain yes or no, nothing runs as them
  const ow = obj(d["outward"]);
  return { cap: text(d["cap"]), act: text(d["act"]), input: obj(d["input"]), ...(Object.keys(ow).length > 0 && Array.isArray(ow["to"]) ? { outward: ow as unknown as Outward } : {}), ...(text(d["holdId"]) ? { holdId: text(d["holdId"]) } : {}), ...(what ? { what } : {}), ...(d["plain"] === true ? { plain: true, detail: text(d["text"]) } : {}) };
}

/** The lines of a plain ask: its detail, when it has one. */
export const plainRows = (h: Held): Array<{ label: string; text: string }> => (h.detail ? [{ label: "Detail", text: h.detail }] : []);

/** The first line of an ask: who asks and what happens, in the capability's own words. */
export function askLine(agent: string, what: string): string {
  return `${agent} asks you to: ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
}

/** The lines of an ask: that it runs as you, once, then every input exactly as the card in Needs you shows it (secrets are handles by then). */
export function askRows(blocks: readonly { type: string; data: unknown }[]): Array<{ label: string; text: string }> {
  const table = obj(blocks.find((b) => b.type === "table")?.data);
  const inputs = Array.isArray(table["rows"]) ? (table["rows"] as unknown[]).map((r) => (Array.isArray(r) ? r.map(text) : [])).filter((r) => r.length >= 2) : [];
  return [{ label: "Runs as", text: "You, once, exactly as shown" }, ...inputs.map((r) => ({ label: label(r[0]!), text: r[1]! }))];
}

/** The phrase after "<Agent> wants to": a known step reads in plain words, any other is its name spelled out. */
export function wantsPhrase(cap: string, subject?: string, input?: Obj): string {
  const outside = cap === "engine.mcp.call" && input ? outsideTool(input) : null;
  if (outside) return outside.phrase;
  // "Send this to Rubab?": the teammate's name, read when the card opens (lane l-agentdm)
  if (cap === "chat.message_person" && subject) return `send this to ${subject}`;
  const base = wantsFromInput(cap, input) ?? WANTS[cap] ?? (cap === "" ? "do a step" : capPhrase(cap));
  const fileStep = cap.startsWith("files.") && cap !== "files.folder.create";
  return subject && (fileStep || cap === "records.update" || cap === "records.delete") ? `${base} ${subject}` : base;
}

/** The first line of the card: who wants what. */
export function wantsLine(agent: string, cap: string, subject?: string, input?: Obj): string {
  return `${agent} wants to ${wantsPhrase(cap, subject, input)}`;
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
  if (k === "url") return "Link";
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
    if (cap === "chat.message_person" && k === "to") continue;   // the headline names the teammate; their id is no line to read
    const t = Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : text(v);
    if (t) out.push({ label: label(k), text: cut(t, k === "body" || k === "text" ? 320 : 120) });
  }
  return out;
}

/** The one-line row an answered card collapses to: "Allowed · edit Q4 pricing.docx". */
export function doneLine(outcome: "allowed" | "denied", cap: string, subject?: string, input?: Obj): string {
  return `${outcome === "allowed" ? "Allowed" : "Denied"} · ${wantsPhrase(cap, subject, input)}`;
}

/** A message to a teammate, answered: "Sent to Noah Berg", and how when the person said yes in words ("approved in chat"). */
export function sentLine(outcome: "allowed" | "denied", subject?: string, inChat = false): string {
  const who = subject ?? "your teammate";
  return outcome === "allowed" ? `Sent to ${who}${inChat ? " · approved in chat" : ""}` : `Not sent to ${who}`;
}

/** What goes back to the agent with a Deny: the person's words, or a plain default (a send back needs a note). */
export const denyNote = (reason: string): string => (reason.trim() === "" ? "Not allowed." : reason.trim());

/** The outcome of a task that has already ended, read from its state. */
export const outcomeOf = (state: string): "allowed" | "denied" | null => (state === "done" ? "allowed" : state === "canceled" || state === "doing" ? "denied" : null);   // a held call sent back rests in doing

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
