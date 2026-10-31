// The record page's right pane, the pure part: how an activity entry reads, how comments fold into threads, how an @mention is found in what was typed, and how a name is told from an agent.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PickEntry } from "../../../../../../ui/src/PeoplePicker/index.tsx";
import { valueText } from "../recordpage/model.ts";
import type { FieldDef, TypeDef } from "../recordpage/model.ts";

export type Activity = CapMap["records.activity"]["out"]["entries"][number];
export type Comment = CapMap["records.comments.list"]["out"]["comments"][number];
export type Mention = Comment["mentions"][number];

export const kindOfId = (id: string): "person" | "agent" => (id.startsWith("agt_") ? "agent" : "person");

const first = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** One short line: who did what. The old and new value are in `activityDetail`, so a row stays one line. */
export function activityLine(e: Activity, def: TypeDef | undefined, names: (id: string) => string): string {
  const who = e.actor === "" ? "Someone" : first(names(e.actor));
  const f = def?.fields.find((x) => x.key === e.field);
  const label = (f?.title ?? e.field ?? "").toLowerCase();
  const to = f && e.to !== undefined && e.to !== null ? valueText(f, e.to, names) : "";
  switch (e.kind) {
    case "created": return `${who} created it`;
    case "removed": return `${who} moved it to Trash`;
    case "restored": return `${who} brought it back`;
    case "stage": return to ? `${who} moved ${label} to ${to}` : `${who} cleared ${label}`;
    case "linked": return `${who} linked ${label}`;
    case "unlinked": return `${who} unlinked ${label}`;
    case "synced": return `${label} updated by a sync`;
    case "edited": return to ? `${who} set ${label} to ${to}` : `${who} cleared ${label}`;
  }
}

/** The tooltip: the old value, an arrow and the new one, then the day. Empty for a row with nothing to compare. */
export function activityDetail(e: Activity, def: TypeDef | undefined, names: (id: string) => string): string {
  const f: FieldDef | undefined = def?.fields.find((x) => x.key === e.field);
  const when = new Date(e.at).toISOString().replace("T", " ").slice(0, 16);
  if (!f || e.field === undefined) return `${when} UTC`;
  const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "empty" : valueText(f, v, names));
  return `${f.title}: ${show(e.from)} to ${show(e.to)}\n${when} UTC`;
}

export interface Thread { root: Comment; replies: Comment[] }

/** A root comment and its replies, oldest first. A reply whose root is not in the list (a hidden or deleted one) is dropped. */
export function threadsOf(comments: readonly Comment[]): Thread[] {
  const roots = comments.filter((c) => c.parentId === undefined);
  const byRoot = new Map<string, Comment[]>();
  for (const c of comments) if (c.parentId !== undefined) byRoot.set(c.parentId, [...(byRoot.get(c.parentId) ?? []), c]);
  return roots.map((root) => ({ root, replies: byRoot.get(root.commentId) ?? [] }));
}

/** Where an @ is being typed: the text after the last @ that starts a word and has no space yet, with where it starts. Null when the cursor is not on a mention. */
export function mentionQuery(text: string): { at: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(text);
  if (!m) return null;
  return { at: text.length - m[2]!.length - 1, query: m[2]! };
}

/** The text with the half-typed @word replaced by the chosen name and a space. */
export function insertMention(text: string, name: string): string {
  const q = mentionQuery(text);
  return q ? `${text.slice(0, q.at)}@${name} ` : text;
}

/** People and agents whose name starts a word of the query, people first. */
export function candidates(all: readonly PickEntry[], query: string): PickEntry[] {
  const w = query.trim().toLowerCase();
  const hit = (e: PickEntry): boolean => w === "" || e.name.toLowerCase().split(/\s+/).some((p) => p.startsWith(w)) || e.name.toLowerCase().startsWith(w);
  return all.filter(hit).sort((a, b) => Number(a.kind === "agent") - Number(b.kind === "agent")).slice(0, 6);
}

/** The people and agents a text names with @Name, longest name first so "Maya Chen" wins over "Maya"; each once. */
export function mentionsIn(text: string, all: readonly PickEntry[]): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  for (const e of [...all].sort((a, b) => b.name.length - a.name.length)) {
    const re = new RegExp(`(^|\\s)@${e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s.,;:!?)])`, "i");
    if (re.test(text) && !seen.has(e.id)) { seen.add(e.id); out.push({ kind: kindOfId(e.id), id: e.id }); }
  }
  return out;
}

/** The comment text as pieces: plain words and the @names that are mentions. */
export function mentionPieces(text: string, names: readonly string[]): { text: string; mention: boolean }[] {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return [{ text, mention: false }];
  const re = new RegExp(`(^|\\s)(@(?:${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))(?=$|[\\s.,;:!?)])`, "gi");
  const out: { text: string; mention: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const start = (m.index ?? 0) + m[1]!.length;
    if (start > at) out.push({ text: text.slice(at, start), mention: false });
    out.push({ text: m[2]!, mention: true });
    at = start + m[2]!.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), mention: false });
  return out;
}

/** "Intake is replying", "Intake and Docs are replying". */
export function replyingLine(ids: readonly string[], names: (id: string) => string): string {
  const who = ids.map((i) => first(names(i)));
  if (who.length === 0) return "";
  return who.length === 1 ? `${who[0]} is replying` : `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]} are replying`;
}
