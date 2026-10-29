// Knowledge in Files: the pure part shared by Learned, People, Clients, Projects, Topics, the living page, History, Trash, Archive and Search. Where the person is (a route), the words for
// ages and layers, the fact and page rows as the screens read them, and the small rules every screen uses (what a day group is, what a source chip says). No React and no clock.
import type { CapMap } from "../../../../../../generated/types.ts";

type BaseFact = CapMap["memory.facts.list"]["out"]["facts"][number];
export type PageRow = CapMap["memory.page.get"]["out"]["page"];
export type PageKind = PageRow["kind"];
export type PageLink = CapMap["memory.page.get"]["out"]["links"][number];
export type Backlink = CapMap["memory.backlinks"]["out"]["backlinks"][number];
export type LearnedItem = CapMap["memory.learned"]["out"]["items"][number];
export type TrailRow = CapMap["memory.trail"]["out"]["rows"][number];
export type Question = CapMap["memory.questions.list"]["out"]["questions"][number];

/** What a fact row adds for the screens: the subject it is about, the title of its source, who wrote it, how many versions it has. All optional, so a row without them still draws as plain text. */
export interface FactExtra {
  subject?: { pageId: string; title: string; kind: PageKind };
  sourceTitle?: string;
  by?: string;
  byKind?: "person" | "agent" | "upkeep";
  versions?: number;
}
export type KFact = BaseFact & FactExtra;

// ---------------------------------------------------------------- where the person is

export type ListKind = "person" | "client" | "project" | "topic";

/** The Knowledge screen that has the body of Files. `from` is where Back goes when a page was opened from a list or a graph. */
export type KnowRoute =
  | { v: "learned" }
  | { v: "list"; kind: ListKind }
  | { v: "page"; pageId: string; hl?: string }
  | { v: "graph"; focus?: string; scope?: "around" | "space"; edge?: string }
  | { v: "history"; pageId?: string }
  | { v: "trash"; pageId?: string }
  | { v: "archive" }
  | { v: "search"; q: string };

export type KnowView = KnowRoute["v"];

export const LIST_KINDS: readonly ListKind[] = ["person", "client", "project", "topic"];
export const LIST_TITLE: Record<ListKind, string> = { person: "People", client: "Clients", project: "Projects", topic: "Topics" };
export const LIST_LEDE: Record<ListKind, string> = {
  person: "The people on your team and what Vyre knows about working with them.",
  client: "Clients and their contacts: preferences, plans, history.",
  project: "Each project keeps its own facts, shared with the people on it.",
  topic: "Rules and ideas that cut across clients and projects.",
};
export const KIND_ONE: Record<PageKind, string> = { person: "Person", client: "Client", project: "Project", agent: "Agent", record: "Record", topic: "Topic", decision: "Decision", site: "Site" };
export const KIND_MANY: Record<PageKind, string> = { person: "People", client: "Clients", project: "Projects", agent: "Agents", record: "Records", topic: "Topics", decision: "Decisions", site: "Sites" };

/** The sidebar rows of Knowledge, in order. Search is not a row: it is the field in every header. */
export const KNOW_ROWS: readonly { id: string; title: string; glyph: string; route: KnowRoute }[] = [
  { id: "learned", title: "Learned", glyph: "bulb", route: { v: "learned" } },
  { id: "people", title: "People", glyph: "person", route: { v: "list", kind: "person" } },
  { id: "clients", title: "Clients", glyph: "users", route: { v: "list", kind: "client" } },
  { id: "projects", title: "Projects", glyph: "folder", route: { v: "list", kind: "project" } },
  { id: "topics", title: "Topics", glyph: "hash", route: { v: "list", kind: "topic" } },
  { id: "graph", title: "Graph", glyph: "graph", route: { v: "graph" } },
  { id: "history", title: "History", glyph: "history", route: { v: "history" } },
  { id: "trash", title: "Trash", glyph: "trash", route: { v: "trash" } },
  { id: "archive", title: "Archive", glyph: "archive", route: { v: "archive" } },
];

/** The sidebar row a route lights. A page lights the list of its kind; a search lights nothing. */
export function rowOf(r: KnowRoute, pageKind?: PageKind): string | null {
  switch (r.v) {
    case "learned": return "learned";
    case "list": return r.kind === "person" ? "people" : r.kind === "client" ? "clients" : r.kind === "project" ? "projects" : "topics";
    case "page": return pageKind === "person" ? "people" : pageKind === "client" ? "clients" : pageKind === "project" ? "projects" : pageKind === "topic" ? "topics" : null;
    case "graph": return "graph";
    case "history": return "history";
    case "trash": return "trash";
    case "archive": return "archive";
    case "search": return null;
  }
}

export const sameRoute = (a: KnowRoute, b: KnowRoute): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- words

export const LAYER_NAME: Record<BaseFact["layer"], string> = { space: "Space", project: "Project", agent: "Agent", person: "Private to you" };

const DAY = 86_400_000;
/** "today", "yesterday", "11 days ago", "1 month ago", "3 months ago": how old a fact is, as the page says it. */
export function ageText(at: number, now: number): string {
  const d = Math.floor((now - at) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  if (d < 60) return "1 month ago";
  return `${Math.floor(d / 30)} months ago`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const two = (n: number): string => String(n).padStart(2, "0");
/** "Today 9:40", "Yesterday 17:00", "Oct 22 9:12": the time a line of the feed or the trail carries (UTC, so a test and a screenshot agree). */
export function stampText(at: number, now: number): string {
  const d = new Date(at), t = `${d.getUTCHours()}:${two(d.getUTCMinutes())}`;
  const days = Math.floor(now / DAY) - Math.floor(at / DAY);
  if (days <= 0) return `Today ${t}`;
  if (days === 1) return `Yesterday ${t}`;
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()} ${t}`;
}

/** "Oct 22" for the Notes line, "Today" or a date for a Mentioned in row. */
export function dateText(at: number, now: number): string {
  if (Math.floor(now / DAY) === Math.floor(at / DAY)) return "Today";
  const d = new Date(at);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export type DayGroup = "Today" | "Yesterday" | "Earlier";
export function dayGroup(at: number, now: number): DayGroup {
  const days = Math.floor(now / DAY) - Math.floor(at / DAY);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : "Earlier";
}

/** A list cut into the day groups, in the order the feed draws them, an empty group left out. */
export function groupByDay<T>(items: readonly T[], at: (x: T) => number, now: number): { label: DayGroup; items: T[] }[] {
  const order: DayGroup[] = ["Today", "Yesterday", "Earlier"];
  const out: { label: DayGroup; items: T[] }[] = [];
  for (const label of order) {
    const list = items.filter((x) => dayGroup(at(x), now) === label);
    if (list.length > 0) out.push({ label, items: list });
  }
  return out;
}

/** The icon family of a source chip. */
export type SourceGlyph = "chat" | "channel" | "record" | "run" | "note";
export function sourceGlyph(k: BaseFact["sourceKind"]): SourceGlyph {
  return k === "chat" ? "chat" : k === "channel" ? "channel" : k === "record" ? "record" : k === "run" || k === "journey" ? "run" : "note";
}

/** The label on a source chip: the title of the chat, run or record when the row has it, otherwise a plain name for the kind. */
export function chipLabel(f: KFact): string {
  if (f.sourceTitle) return f.sourceTitle;
  return f.sourceKind === "chat" ? "A chat" : f.sourceKind === "channel" ? "A channel" : f.sourceKind === "record" ? "A record" : f.sourceKind === "run" ? "An automation run" : f.sourceKind === "journey" ? "A journey" : f.sourceKind === "task" ? "A task" : "Written by hand";
}

/** "Intake learned it from Maya Chen", "Billing wrote it down", "you": who a line credits. `who` turns an id into a name. */
export function learnedLine(item: LearnedItem & { fact: KFact }, who: (id: string) => string): string {
  const agent = who(item.actor);
  if (item.actorKind === "person") return item.from && item.from !== item.actor ? `${agent} noted it from ${who(item.from)}` : `${agent === "you" ? "You" : agent} wrote it down`;
  return item.from ? `${agent} learned it from ${item.from === "you" ? "you" : who(item.from)}` : `${agent} wrote it down`;
}

/** Plural helper: "1 fact", "2 facts". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The first-letter tile colour of a name, a hue from its text, so a person keeps one colour everywhere. */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** `[[Page]]` links in a Notes text, in order: the title between the brackets. */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]!);
  return out;
}

/** The text a [[ autocomplete is completing at a caret: what follows an open [[ with no ]] yet, or null when the caret is not inside a link. */
export function openLinkAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const i = before.lastIndexOf("[[");
  if (i < 0) return null;
  const rest = before.slice(i + 2);
  if (rest.includes("]]") || rest.includes("\n")) return null;
  return { start: i, query: rest };
}

// ---------------------------------------------------------------- the route in the tab's hash (back, forward and links follow it)

export const KNOW_SCREEN = "files.knowledge";

/** A route as the hash args that name it (every value a string, nothing set when it is not used). */
export function routeToArgs(r: KnowRoute): Record<string, string> {
  switch (r.v) {
    case "list": return { v: "list", kind: r.kind };
    case "page": return { v: "page", pageId: r.pageId, ...(r.hl ? { hl: r.hl } : {}) };
    case "graph": return { v: "graph", ...(r.focus ? { focus: r.focus } : {}), ...(r.scope ? { scope: r.scope } : {}), ...(r.edge ? { edge: r.edge } : {}) };
    case "history": case "trash": return { v: r.v, ...(r.pageId ? { pageId: r.pageId } : {}) };
    case "search": return { v: "search", q: r.q };
    default: return { v: r.v };
  }
}

/** The route a hash names; anything it does not understand opens Learned. */
export function routeFromArgs(a: Record<string, unknown>): KnowRoute {
  const s = (k: string): string | undefined => (typeof a[k] === "string" && (a[k] as string) !== "" ? (a[k] as string) : undefined);
  switch (s("v")) {
    case "list": { const k = s("kind"); return { v: "list", kind: k === "client" || k === "project" || k === "topic" ? k : "person" }; }
    case "page": { const id = s("pageId"); return id ? { v: "page", pageId: id, ...(s("hl") ? { hl: s("hl")! } : {}) } : { v: "learned" }; }
    case "graph": { const sc = s("scope"); return { v: "graph", ...(s("focus") ? { focus: s("focus")! } : {}), ...(sc === "around" || sc === "space" ? { scope: sc } : {}), ...(s("edge") ? { edge: s("edge")! } : {}) }; }
    case "history": return { v: "history", ...(s("pageId") ? { pageId: s("pageId")! } : {}) };
    case "trash": return { v: "trash", ...(s("pageId") ? { pageId: s("pageId")! } : {}) };
    case "archive": return { v: "archive" };
    case "search": return { v: "search", q: s("q") ?? "" };
    default: return { v: "learned" };
  }
}
