// Notes, the pure part: which notes the grid shows (Pinned, then Others), the label filter with its counts and its special rows (Shared with me, From Chrome, With images), the search,
// and the words a card and the share sheet say about who sees a note. No React here, so the grid's rules run as plain tests.
import type { CapMap } from "../../../../../../generated/types.ts";

export type Note = CapMap["notes.list"]["out"]["notes"][number];
export type NoteColor = Note["color"];
export type LabelCount = { name: string; count: number };

/** The seven colours, in the order the swatches show them. */
export const COLORS: readonly (readonly [NoteColor, string])[] = [["", "Default"], ["rose", "Rose"], ["sand", "Sand"], ["sage", "Sage"], ["sky", "Sky"], ["lilac", "Lilac"], ["slate", "Slate"]];

/** The filter's rows under the labels. A filter key is a label name or one of these. */
export const SHARED = ":shared";
export const CHROME = ":chrome";
export const IMAGES = ":img";
export const SPECIAL: readonly { key: string; label: string; icon: "people" | "clip" | "image" }[] = [
  { key: SHARED, label: "Shared with me", icon: "people" },
  { key: CHROME, label: "From Chrome", icon: "clip" },
  { key: IMAGES, label: "With images", icon: "image" },
];

/** A note is shown when it matches any ticked row (the filter is an "or"); nothing ticked shows every note. */
export function matchesFilter(n: Note, filter: readonly string[]): boolean {
  if (filter.length === 0) return true;
  return filter.some((f) => (f === SHARED ? !n.mine : f === CHROME ? n.clip !== undefined : f === IMAGES ? n.hasImage : n.labels.includes(f)));
}

/** The search box: title, text, labels, a link's title, site and address, a clipped page's selection, title and address. */
export function matchesQuery(n: Note, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") return true;
  const hay = [n.title, n.body, n.labels.join(" "), n.link?.title, n.link?.siteName, n.link?.url, n.clip?.selection, n.clip?.title, n.clip?.url].filter((x) => typeof x === "string").join(" ").toLowerCase();
  return hay.includes(needle);
}

export function visibleNotes(notes: readonly Note[], filter: readonly string[], q: string): Note[] {
  return notes.filter((n) => matchesFilter(n, filter) && matchesQuery(n, q));
}

/** Pinned notes sit above the rest; each group keeps the order it came in (newest first). */
export function splitPinned(notes: readonly Note[]): { pinned: Note[]; others: Note[] } {
  return { pinned: notes.filter((n) => n.pinned), others: notes.filter((n) => !n.pinned) };
}

/** The labels the filter lists, with how many notes carry each. Labels the server named keep its order; a label only a local note has goes after them. */
export function labelCounts(notes: readonly Note[], known: readonly string[] = []): LabelCount[] {
  const order: string[] = [];
  for (const l of known) if (!order.includes(l)) order.push(l);
  for (const n of notes) for (const l of n.labels) if (!order.includes(l)) order.push(l);
  return order.map((name) => ({ name, count: notes.filter((n) => n.labels.includes(name)).length }));
}

/** What the filter button says: "Labels", the one row ticked, or the first and how many more. */
export function filterLabel(filter: readonly string[]): string {
  if (filter.length === 0) return "Labels";
  const name = (f: string): string => SPECIAL.find((s) => s.key === f)?.label ?? f;
  const first = name(filter[0]!);
  return filter.length === 1 ? first : `${first} and ${filter.length - 1} more`;
}

export function toggle(list: readonly string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** A note's name where one line is all there is room for. */
export function noteName(n: Pick<Note, "title" | "link" | "clip">): string {
  return n.title || n.link?.title || n.clip?.title || "Note";
}

/** The first line of a note's text, for the Ask pane's About line. */
export function firstLine(n: Pick<Note, "body" | "clip" | "link">): string {
  return (n.body || n.clip?.selection || n.link?.description || "").split("\n")[0] ?? "";
}

export interface Who { meId: string; nameOf(id: string): string; spaceName: string }

/** Who sees a note, in words: the short form a card shows and the long form the opened note and its share button say. */
export function shareWords(n: Pick<Note, "mine" | "owner" | "share">, w: Who): { icon: "people" | "globe" | "lock"; short: string; long: string } {
  if (!n.mine) {
    const role = n.share.people.find((p) => p.personId === w.meId)?.role ?? (n.share.space === "edit" ? "edit" : "view");
    return { icon: "people", short: `From ${w.nameOf(n.owner)}`, long: `Shared with you by ${w.nameOf(n.owner)} · you can ${role === "edit" ? "edit" : "view"}` };
  }
  const ppl = n.share.people.map((p) => w.nameOf(p.personId));
  if (n.share.space !== "off") return { icon: "globe", short: "Space", long: `Shared with ${w.spaceName}${ppl.length ? ` and ${ppl.join(", ")}` : ""}` };
  if (ppl.length) return { icon: "people", short: ppl.join(", "), long: `Shared with ${ppl.join(" and ")}` };
  return { icon: "lock", short: "", long: "Private" };
}

/** The sentence about agents under the share sheet, and the opened note's share button tooltip: an agent reads what everyone in its chat may read. */
export function agentWords(n: Pick<Note, "mine" | "owner" | "share">, w: Who): string {
  if (!n.mine) return `${w.nameOf(n.owner)} shared it with you, so your agents can read it in your own chats.`;
  const ppl = n.share.people.map((p) => w.nameOf(p.personId));
  if (n.share.space !== "off") return `Everyone in ${w.spaceName} can see it. Agents can read it in any chat or channel in the Space.`;
  if (ppl.length) return `${ppl.join(" and ")} can see it. Your agents can read it in your own chats, and theirs in their own chats. Agents in channels cannot.`;
  return "Private. Only you see it. Your agents can read it in your own chats, never in a channel or someone else's chat.";
}

/** The line under the Ask pane: whether Vyre may read this note here. */
export function askWords(n: Pick<Note, "mine" | "owner" | "share">): string {
  const priv = n.mine && n.share.people.length === 0 && n.share.space === "off";
  return priv ? "Your own chat, so Vyre can read this private note here. In a channel it cannot." : "Vyre reads it here because you can see it.";
}

const DAY = 86_400_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A time the way a note says it: "9:14" today, "Sat" this week, "28 Oct" before that. `offsetMin` is the person's zone. */
export function whenWords(at: number, now: number, offsetMin = 0): string {
  const local = (t: number): Date => new Date(t + offsetMin * 60_000);
  const a = local(at), b = local(now);
  const dayOf = (d: Date): number => Math.floor(d.getTime() / DAY);
  const diff = dayOf(b) - dayOf(a);
  if (diff <= 0) return `${a.getUTCHours()}:${String(a.getUTCMinutes()).padStart(2, "0")}`;
  if (diff < 7) return WEEKDAY[a.getUTCDay()]!;
  return `${a.getUTCDate()} ${MONTH[a.getUTCMonth()]}`;
}

/** The quiet line on an opened note: "Clipped 10:42", "Edited Sat", "Edited just now". */
export function editedWords(n: Pick<Note, "clip" | "createdAt" | "updatedAt">, now: number, offsetMin = 0): string {
  const verb = n.clip && n.updatedAt - n.createdAt < 1000 ? "Clipped" : "Edited";
  if (now - n.updatedAt < 60_000) return `${verb} just now`;
  return `${verb} ${whenWords(n.updatedAt, now, offsetMin)}`;
}

/** Where a note was saved from, for the line on the opened note: "From: Weinberger Law prep, 9:12". Null when it came from nowhere. A chat its owner can no longer read keeps only the time. */
export function fromLine(n: Pick<Note, "from">, now: number, offsetMin = 0): { text: string; open: { threadId: string; messageId: string } | null } | null {
  const f = n.from;
  if (!f) return null;
  const when = whenWords(f.at, now, offsetMin);
  if (!f.readable || !f.threadId || !f.messageId) return { text: `From a chat you can no longer read, ${when}`, open: null };
  return { text: `From: ${f.title || "a chat"}, ${when}`, open: { threadId: f.threadId, messageId: f.messageId } };
}

/** A host as a link card names it when the page gave no site name. */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").split(/[/?#]/)[0]!.replace(/^www\./, "");
}

/** The address without its scheme or a closing slash, as a card shows it. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** The coloured letter a link card shows for its site. */
export function siteMark(site: string): { letter: string; color: string } {
  const palette = ["#C88A12", "#2F4C8C", "#16805A", "#B4436C", "#5A3FF0", "#0E7490", "#6A6578"];
  let h = 0;
  for (const c of site) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { letter: (site.trim()[0] ?? "?").toUpperCase(), color: palette[h % palette.length]! };
}

/** A note changed here before the server answered: the fields that changed laid over the row. */
export function patchNote(n: Note, p: Partial<Pick<Note, "title" | "body" | "color" | "pinned" | "labels">>, now: number): Note {
  return { ...n, ...p, updatedAt: now };
}

/** The list with one note put back in its place (by id), or added first when it is new. */
export function upsert(notes: readonly Note[], n: Note): Note[] {
  const at = notes.findIndex((x) => x.noteId === n.noteId);
  if (at < 0) return [n, ...notes];
  const out = notes.slice();
  out[at] = n;
  return out;
}

/** The scheme a link the grid may open in the browser. Anything else is shown, never opened. */
export function openable(url: string): string | null {
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url)) return `https://${url}`;
  return null;
}

/* ---------- the task and record sheets ---------- */

export interface DueChoice { label: string; at: number | null }

/** The days a task can be due from the sheet: today, tomorrow, the next five days by name and date, or none. Each at the end of that day in the person's zone. */
export function dueChoices(now: number, offsetMin = 0): DueChoice[] {
  const DAY = 86_400_000;
  const local = now + offsetMin * 60_000;
  const end = (d: number): number => (Math.floor(local / DAY) + d + 1) * DAY - offsetMin * 60_000 - 1;
  const name = (t: number): string => { const d = new Date(t + offsetMin * 60_000); return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`; };
  const out: DueChoice[] = [{ label: "Today", at: end(0) }, { label: "Tomorrow", at: end(1) }];
  for (let d = 2; d <= 6; d++) out.push({ label: name(end(d)), at: end(d) });
  out.push({ label: "No date", at: null });
  return out;
}

export interface RecordType { key: string; title: string; plural: string; titleField: string; summaryField?: string; fields: { key: string; type: string; title: string }[] }

/** The fields the sheet asks for: the type's title field first, then its summary, then the next text fields, four at most. */
export function recordFields(t: RecordType): { key: string; title: string }[] {
  const text = (f: { type: string }): boolean => ["text", "string", "longtext", "email", "phone", "url"].includes(f.type);
  const keys = [t.titleField, ...(t.summaryField ? [t.summaryField] : []), ...t.fields.filter(text).map((f) => f.key)];
  const out: { key: string; title: string }[] = [];
  for (const k of keys) {
    if (out.some((o) => o.key === k)) continue;
    const f = t.fields.find((x) => x.key === k);
    if (f) out.push({ key: f.key, title: f.title });
    if (out.length === 4) break;
  }
  return out;
}

/** The fields filled from the note: its title names the record, its first line sums it up. */
export function fillFromNote(t: RecordType, n: Pick<Note, "title" | "body" | "link" | "clip">): Record<string, string> {
  const out: Record<string, string> = {};
  out[t.titleField] = noteName(n) === "Note" ? "" : noteName(n);
  const first = (n.body.split("\n")[0] ?? "").trim();
  if (t.summaryField && first) out[t.summaryField] = first;
  return out;
}
