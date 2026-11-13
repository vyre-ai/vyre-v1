// The Chats sidebar of the 13 Nov design (team/v1/SIDEBAR-2026-11-13.md, Part 2): the pure part, no drawing and no reads.
// One function, `buildLayout`, turns what the sidebar reads today (as `Item`s, made by `itemsFrom`) into the six blocks in order, each capped, with its one mark per row, the count and marks of a folded
// head, the "N more" that carries what it hides, the filter choices and the rail's one number. It sits beside the old model (`model.ts`) and is switched in at one place; nothing here changes `model.ts`.
import type { Agent, Channel, ChatRow, MutedFn, NeedsItem } from "./model.ts";
import type { GoalLine } from "../goals/model.ts";
import type { ProjectLine } from "../projects/model.ts";

// ---------------------------------------------------------------- the words of the design

/** The six blocks, top to bottom. Needs you is the Tasks row with its waiting items under it; the others have a head. */
export type SectionId = "needs" | "now" | "pinned" | "chats" | "channels" | "team";
export const SECTION_ORDER: readonly SectionId[] = ["needs", "now", "pinned", "chats", "channels", "team"];
export const SECTION_LABEL: Record<SectionId, string> = {
  needs: "Needs you",
  now: "Now",
  pinned: "Pinned",
  chats: "Chats",
  channels: "Channels",
  team: "Team",
};
/** Hard caps (design 2.4): "N more" carries the marks of what it hides, so nothing is hidden silently and nothing pushes the rest away. */
export const CAPS: Record<SectionId, number> = { needs: 3, now: 4, pinned: 6, chats: 6, channels: 5, team: 5 };
/** What a failed read of a section says it could not load: "Couldn't load chats". */
export const SECTION_WHAT: Record<SectionId, string> = {
  needs: "what needs you",
  now: "what is happening now",
  pinned: "pinned items",
  chats: "chats",
  channels: "channels",
  team: "the team",
};
/** Fixed row heights, so the window needs no measuring (design 2.9). */
export const H = { row: 32, two: 44, head: 34, more: 28, error: 32, none: 40, tasks: 32 } as const;
/** Cmd-1 to Cmd-9 open the first nine pinned rows. */
export const MAX_PIN_DIGITS = 9;

/** What a row is, which says where it lives and which menu it has. */
export type ItemKind = "chat" | "dm" | "channel" | "project" | "goal" | "person" | "agent" | "task";
/** What a row looks like at its left: person, agent, Assistant, group, channel, project, goal (progress ring), task (the asking face with the amber ring). */
export type Shape = "person" | "agent" | "assistant" | "group" | "channel" | "project" | "goal" | "task";

export type Mark =
  | { kind: "failed"; why?: string }
  | { kind: "muted" }
  | { kind: "mention"; count: number }
  | { kind: "unread" }
  | { kind: "draft" }
  | { kind: "working" };
/** The importance order of the one mark on a row (design 2.3). */
export const MARK_ORDER: readonly Mark["kind"][] = ["failed", "muted", "mention", "unread", "draft", "working"];

export interface Item {
  /** The stable entry key: "c:<thread>", "ch:<channel>", "pj:<project>", "g:<goal>", "p:<person>", "f:<agent>", "n:<task>". */
  key: string;
  kind: ItemKind;
  shape: Shape;
  title: string;
  /** The second line of a Needs you or Now row: what is waiting, or what it is doing. */
  sub?: string;
  /** Ids of the faces on the row: the one actor, or the first of a group. */
  faces: readonly string[];
  unread: number;
  mentions: number;
  muted: boolean;
  /** The last run stopped: why, in words for the tooltip. */
  failed?: string;
  draft: boolean;
  working: boolean;
  archived: boolean;
  /** An Ask pane opened beside something in another place. */
  ask: boolean;
  /** A goal that has ended (done, missed, stopped). */
  ended: boolean;
  /** Newest first within Chats. */
  lastAt: number;
  /** A needs-you task: the verb at the right. */
  verb?: { label: string; tone: "accent" | "warn" };
  /** A goal: tasks done of all, drawn as the ring. */
  progress?: { done: number; total: number };
  presence?: "online" | "away";
  /** A private channel draws a lock. */
  private?: boolean;
}

// ---------------------------------------------------------------- the one mark of a row, and the sum of marks of a group

/** The one mark a row draws, by importance: failed, muted (which shows nothing else), a mention count, unread, a draft, working. A task row draws its verb instead (`Item.verb`) and no mark. */
export function markOf(
  x: Pick<Item, "kind" | "failed" | "muted" | "mentions" | "unread" | "draft" | "working">,
): Mark | null {
  if (x.kind === "task") return null;
  if (x.failed !== undefined) return { kind: "failed", why: x.failed };
  if (x.muted) return { kind: "muted" };
  if (x.mentions > 0) return { kind: "mention", count: x.mentions };
  if (x.unread > 0) return { kind: "unread" };
  if (x.draft) return { kind: "draft" };
  if (x.working) return { kind: "working" };
  return null;
}

/** The sum of the marks of a group of rows: a folded head and an "N more" draw this. A muted row adds nothing but a failure. */
export interface Agg {
  failed: number;
  mentions: number;
  unread: number;
  working: number;
}
export function aggOf(list: readonly Item[]): Agg {
  const a: Agg = { failed: 0, mentions: 0, unread: 0, working: 0 };
  for (const x of list) {
    if (x.kind === "task") continue;
    if (x.failed !== undefined) a.failed++;
    if (x.muted) continue;
    a.mentions += x.mentions;
    if (x.unread > 0 && x.mentions === 0) a.unread++;
    if (x.working) a.working++;
  }
  return a;
}
/** What a folded head or an "N more" draws: the red circle if anything failed, then a mention count, else a dot for unread, else the working dot. */
export function aggMarks(a: Agg): Mark[] {
  const out: Mark[] = [];
  if (a.failed > 0) out.push({ kind: "failed" });
  if (a.mentions > 0) out.push({ kind: "mention", count: a.mentions });
  else if (a.unread > 0) out.push({ kind: "unread" });
  else if (a.working > 0) out.push({ kind: "working" });
  return out;
}

/**
 * The rail's one badge (design 2.7): what is addressed to me in Chats. Every waiting task, plus the mention count on each row, plus one for a direct message that is new and has no mention (a row draws
 * one mark, so this is the sum of the Tasks count, the mention badges and the direct-message dots). Muted and archived rows add nothing.
 */
export function railCount(items: readonly Item[]): number {
  let n = 0;
  for (const x of items) {
    if (x.kind === "task") {
      n++;
      continue;
    }
    if (x.muted || x.archived) continue;
    if (x.mentions > 0) n += x.mentions;
    else if (x.kind === "dm" && x.unread > 0) n++;
  }
  return n;
}

// ---------------------------------------------------------------- filters

export type FilterId =
  | "all"
  | "unread"
  | "mentions"
  | "working"
  | "needs"
  | "failed"
  | "muted"
  | "goals"
  | "asks"
  | "archived";
export interface FilterChoice {
  id: FilterId;
  label: string;
  group: "show" | "only";
}
/** The filter menu: head "Show" then head "Only" (design 2.5); never pills. */
export const FILTER_CHOICES: readonly FilterChoice[] = [
  { id: "all", label: "Everything", group: "show" },
  { id: "unread", label: "Unread", group: "show" },
  { id: "mentions", label: "Mentions", group: "show" },
  { id: "working", label: "Working now", group: "show" },
  { id: "needs", label: "Needs you", group: "show" },
  { id: "failed", label: "Failed", group: "show" },
  { id: "muted", label: "Muted", group: "show" },
  { id: "goals", label: "Goals", group: "only" },
  { id: "asks", label: "Asks", group: "only" },
  { id: "archived", label: "Archived", group: "only" },
];

/** Does a row pass a filter. Everything leaves out archived chats, Ask panes and ended goals; they are one press away under "Only". */
export function passes(x: Item, f: FilterId): boolean {
  switch (f) {
    case "all":
      return !x.archived && !x.ask && !x.ended;
    case "unread":
      return (x.unread > 0 || x.mentions > 0) && !x.muted && !x.archived && x.kind !== "task";
    case "mentions":
      return x.mentions > 0 && !x.muted && !x.archived;
    case "working":
      return x.working && !x.archived;
    case "needs":
      return x.kind === "task";
    case "failed":
      return x.failed !== undefined && !x.archived;
    case "muted":
      return x.muted && !x.archived;
    case "goals":
      return x.kind === "goal";
    case "asks":
      return x.ask;
    case "archived":
      return x.archived;
  }
}

export interface FilterRow extends FilterChoice {
  count: number;
}
/** The menu's rows with what each will show. */
export function filterChoices(items: readonly Item[]): FilterRow[] {
  return FILTER_CHOICES.map((c) => ({ ...c, count: items.filter((x) => passes(x, c.id)).length }));
}
/** The slim line under the head when a filter is set: "Showing Unread, 6" with a Show all beside it. Null for Everything. */
export function showingLine(items: readonly Item[], f: FilterId): { text: string; count: number } | null {
  if (f === "all") return null;
  const label = FILTER_CHOICES.find((c) => c.id === f)!.label;
  const count = items.filter((x) => passes(x, f)).length;
  return { text: `Showing ${label}, ${count}`, count };
}

// ---------------------------------------------------------------- the flat list of entries

export type LayoutEntry = { key: string; y: number; h: number } & (
  | { type: "tasks"; count: number }
  | { type: "row"; section: SectionId; item: Item; mark: Mark | null; digit?: number }
  | { type: "head"; section: SectionId; label: string; count: number; folded: boolean; agg: Agg; marks: Mark[] }
  /** "N more": opens in place, except under Needs you, where it opens Tasks. It carries the marks of what it hides. */
  | { type: "more"; section: SectionId; hidden: number; agg: Agg; marks: Mark[]; opens: "place" | "tasks" }
  | { type: "less"; section: SectionId }
  | { type: "error"; section: SectionId; what: string }
  | { type: "none" }
  | { type: "skeleton"; head: boolean; width: number }
);

export interface LayoutInput {
  items: readonly Item[];
  /** Pinned item keys, in the person's order. */
  pins: readonly string[];
  filter: FilterId;
  /** Folded sections (per person per Space). A filter shows everything unfolded. */
  folded: ReadonlySet<SectionId>;
  /** Sections whose "N more" is open, for this session. */
  more: ReadonlySet<SectionId>;
  /** The key of the row the middle shows: it is always drawn, swapping in for the last. */
  open: string | null;
  /** Sections whose read failed: a row says so with Retry and the other sections still draw. */
  failed?: ReadonlySet<SectionId>;
  /** The first read has not answered. */
  loading?: boolean;
  /** A Personal Space: no Channels, and Team reads "Agents". */
  personal?: boolean;
  /** A guest sees no Team. */
  guest?: boolean;
  /** Finish setup: done of total; hidden by the person or complete, it is null. */
  setup?: { done: number; total: number } | null;
  /** New things in Notes & artifacts (the row's badge). */
  notesNew?: number;
}

export interface Layout {
  entries: readonly LayoutEntry[];
  /** The scroll height of all entries. */
  height: number;
  /** An empty Space: no headings, no Tasks row, one invitation. */
  empty: boolean;
  loading: boolean;
  tasksCount: number;
  /** Cmd-1 to Cmd-9: the first nine pinned rows by key. */
  digits: ReadonlyMap<string, number>;
  filter: { id: FilterId; showing: { text: string; count: number } | null };
  /** The rail's one badge. */
  rail: number;
  foot: { notes: { new: number } | null; setup: { done: number; total: number } | null };
}

const ORDER_PRESENCE = { online: 0, away: 1 } as const;
const byChats = (a: Item, b: Item): number =>
  Number(a.muted) - Number(b.muted) ||
  b.lastAt - a.lastAt ||
  a.title.localeCompare(b.title) ||
  a.key.localeCompare(b.key);
const CHAT_KINDS: readonly ItemKind[] = ["chat", "dm"];

/** The members of each block after the design's order of precedence: Needs you, then Pinned, then Now, then the item's own block. An item shows once. */
export function sectionsOf(items: readonly Item[], pins: readonly string[], f: FilterId): Record<SectionId, Item[]> {
  const ok = items.filter((x) => passes(x, f));
  const used = new Set<string>();
  const take = (xs: Item[]): Item[] => {
    for (const x of xs) used.add(x.key);
    return xs;
  };
  const needs = take(ok.filter((x) => x.kind === "task"));
  const byKey = new Map(ok.map((x) => [x.key, x]));
  const pinned = take(pins.flatMap((k) => (byKey.has(k) && !used.has(k) ? [byKey.get(k)!] : [])));
  // Now: an agent mid-task in a chat, a goal in motion; then every other goal that has not ended (a goal is work in motion)
  const live = (x: Item): boolean =>
    !used.has(x.key) &&
    ((x.working && (x.kind === "chat" || x.kind === "dm" || x.kind === "goal")) ||
      (x.kind === "goal" && !x.ended && f === "all"));
  const nowItems = take(ok.filter((x) => live(x)));
  const rest = ok.filter((x) => !used.has(x.key));
  const goals = rest.filter((x) => x.kind === "goal");
  const chats = rest.filter((x) => CHAT_KINDS.includes(x.kind) || (f === "archived" && x.archived)).sort(byChats);
  const channels = rest
    .filter((x) => x.kind === "channel" || x.kind === "project")
    .map((x, n) => ({ x, n }))
    .sort((a, b) => Number(a.x.muted) - Number(b.x.muted) || a.n - b.n)
    .map((e) => e.x);
  const team = rest
    .filter((x) => x.kind === "person" || x.kind === "agent")
    .sort(
      (a, b) =>
        Number(b.kind === "person") - Number(a.kind === "person") ||
        (ORDER_PRESENCE[a.presence ?? "away"] ?? 2) - (ORDER_PRESENCE[b.presence ?? "away"] ?? 2) ||
        Number(b.working) - Number(a.working),
    );
  return { needs, now: [...nowItems, ...goals], pinned, chats, channels, team };
}

/** The first `cap` of a list; the open row, if cut, swaps in for the last shown. The rest is what "N more" holds. */
export function capList(list: readonly Item[], cap: number, open: string | null): { shown: Item[]; hidden: Item[] } {
  if (list.length <= cap) return { shown: [...list], hidden: [] };
  let shown = list.slice(0, cap);
  const op = open === null ? undefined : list.find((x) => x.key === open);
  if (op && !shown.includes(op)) shown = [...shown.slice(0, cap - 1), op];
  return { shown, hidden: list.filter((x) => !shown.includes(x)) };
}

/** The six blocks of the sidebar as one flat list of typed entries with fixed heights. */
export function buildLayout(i: LayoutInput): Layout {
  const failed = i.failed ?? new Set<SectionId>();
  const items = i.guest ? i.items.filter((x) => x.kind !== "person" && x.kind !== "agent") : i.items;
  const out: LayoutEntry[] = [];
  let y = 0;
  const push = <E extends Omit<LayoutEntry, "y" | "h">>(e: E, h: number): void => {
    out.push({ ...e, y, h } as LayoutEntry);
    y += h;
  };
  const filtered = i.filter !== "all";
  const digits = new Map<string, number>();
  const pinKeys = new Set(items.filter((x) => !x.archived).map((x) => x.key));
  i.pins
    .filter((k) => pinKeys.has(k))
    .slice(0, MAX_PIN_DIGITS)
    .forEach((k, n) => digits.set(k, n + 1));
  const base = {
    filter: { id: i.filter, showing: showingLine(items, i.filter) },
    digits,
    rail: railCount(items),
  };

  if (i.loading === true) {
    for (let g = 0; g < 3; g++) {
      push({ key: `sk:${g}`, type: "skeleton", head: true, width: 40 }, H.head);
      for (let r = 0; r < (g === 0 ? 3 : 4); r++)
        push({ key: `sk:${g}:${r}`, type: "skeleton", head: false, width: 46 + ((g * 17 + r * 23) % 38) }, H.row);
    }
    return {
      ...base,
      entries: out,
      height: y,
      empty: false,
      loading: true,
      tasksCount: 0,
      rail: 0,
      foot: { notes: null, setup: null },
    };
  }
  const empty = items.length === 0 && failed.size === 0;
  if (empty) {
    return {
      ...base,
      entries: [],
      height: 0,
      empty: true,
      loading: false,
      tasksCount: 0,
      foot: { notes: null, setup: i.setup ?? null },
    };
  }

  const sec = sectionsOf(items, i.pins, i.filter);
  if (!filtered) push({ key: "tasks", type: "tasks", count: sec.needs.length }, H.tasks);
  for (const s of SECTION_ORDER) {
    if (s === "channels" && i.personal === true) continue;
    if (s === "team" && i.guest === true) continue;
    const list = sec[s];
    const fail = failed.has(s);
    if (s === "needs") {
      const { shown, hidden } = filtered ? { shown: list, hidden: [] } : capList(list, CAPS.needs, null);
      if (fail) push({ key: "e:needs", type: "error", section: s, what: SECTION_WHAT.needs }, H.error);
      for (const x of shown) push({ key: x.key, type: "row", section: s, item: x, mark: null }, H.two);
      if (hidden.length > 0)
        push(
          {
            key: "m:needs",
            type: "more",
            section: s,
            hidden: hidden.length,
            agg: aggOf(hidden),
            marks: [],
            opens: "tasks",
          },
          H.more,
        );
      continue;
    }
    if (list.length === 0 && !fail) continue;
    const folded = i.folded.has(s) && !filtered;
    const label = s === "team" && i.personal === true ? "Agents" : SECTION_LABEL[s];
    const agg = aggOf(list);
    push(
      { key: `h:${s}`, type: "head", section: s, label, count: list.length, folded, agg, marks: aggMarks(agg) },
      H.head,
    );
    if (folded) continue;
    if (fail) {
      push({ key: `e:${s}`, type: "error", section: s, what: SECTION_WHAT[s] }, H.error);
      if (list.length === 0) continue;
    }
    const h = s === "now" ? H.two : H.row;
    const expanded = filtered || i.more.has(s);
    const { shown, hidden } = expanded ? { shown: list, hidden: [] } : capList(list, CAPS[s], i.open);
    for (const x of shown) {
      const d = s === "pinned" ? digits.get(x.key) : undefined;
      push({ key: x.key, type: "row", section: s, item: x, mark: markOf(x), ...(d ? { digit: d } : {}) }, h);
    }
    if (hidden.length > 0) {
      const a = aggOf(hidden);
      push(
        { key: `m:${s}`, type: "more", section: s, hidden: hidden.length, agg: a, marks: aggMarks(a), opens: "place" },
        H.more,
      );
    } else if (i.more.has(s) && list.length > CAPS[s] && !filtered)
      push({ key: `m:${s}`, type: "less", section: s }, H.more);
  }
  if (filtered && out.length === 0) push({ key: "none", type: "none" }, H.none);
  return {
    ...base,
    entries: out,
    height: y,
    empty: false,
    loading: false,
    tasksCount: sec.needs.length,
    foot: { notes: { new: i.notesNew ?? 0 }, setup: i.setup ?? null },
  };
}

// ---------------------------------------------------------------- from what the sidebar reads today to Items

/** What a waiting task asks of me: the verb at the right of its row (design 2.2). */
export function needsVerb(item: NeedsItem): { label: string; tone: "accent" | "warn" } {
  const t = item.task;
  if (t.kind === "unblock" || t.blocked) return { label: "Blocked", tone: "warn" };
  if (t.kind === "approve") return { label: "Allow", tone: "accent" };
  if (t.kind === "answer") return { label: "Answer", tone: "accent" };
  if (t.kind === "signature") return { label: "Sign", tone: "accent" };
  return { label: "Review", tone: "accent" };
}

/** Everything the sidebar reads today, as the old model takes it. `mentions`, `failed` and `drafts` are keyed by item key; today's reads carry none of them for a row, so they are optional. */
export interface ItemSource {
  chats: readonly ChatRow[];
  channels: readonly Channel[];
  projects?: readonly ProjectLine[];
  goals?: readonly GoalLine[];
  people?: readonly { id: string; name: string }[];
  agents?: readonly Agent[];
  assistant?: { agentId: string; name: string } | undefined;
  needs?: readonly NeedsItem[];
  presence?: ReadonlyMap<string, "online" | "away">;
  workingAgents?: ReadonlySet<string>;
  muted?: MutedFn;
  mentions?: ReadonlyMap<string, number>;
  failed?: ReadonlyMap<string, string>;
  drafts?: ReadonlySet<string>;
  /** Thread ids of Ask panes. */
  asks?: ReadonlySet<string>;
  /** Goal chats are the Goal row's, never a second row. */
  goalThreads?: ReadonlySet<string>;
  /** Agent names by id, for a waiting task's asker. */
  agentName?: (id: string) => string;
}

const ENDED: ReadonlySet<string> = new Set(["done", "missed", "stopped"]);
const base = (): Pick<
  Item,
  "faces" | "unread" | "mentions" | "muted" | "draft" | "working" | "archived" | "ask" | "ended" | "lastAt"
> => ({
  faces: [],
  unread: 0,
  mentions: 0,
  muted: false,
  draft: false,
  working: false,
  archived: false,
  ask: false,
  ended: false,
  lastAt: 0,
});

/** The rows of every block from the reads the sidebar already makes. A person with a direct message is that chat's row (in Chats or Pinned), so Team lists only people without one: an actor shows once. */
export function itemsFrom(s: ItemSource): Item[] {
  const muted = s.muted ?? (() => false);
  const out: Item[] = [];
  const failedOf = (k: string): { failed?: string } => (s.failed?.has(k) ? { failed: s.failed.get(k) ?? "" } : {});
  const assistantId = s.assistant?.agentId;
  const dmWith = new Set<string>();
  const seen = new Set<string>();
  for (const r of s.chats) {
    if (seen.has(r.threadId) || s.goalThreads?.has(r.threadId) === true || r.goalId !== undefined) continue;
    seen.add(r.threadId);
    const key = `c:${r.threadId}`;
    const direct = r.direct === true;
    if (direct && r.whoId) dmWith.add(r.whoId);
    const group = !direct && (r.members !== undefined || (r.withPeople === true && r.kind === "person"));
    const shape: Shape = direct
      ? "person"
      : group
        ? "group"
        : r.whoId !== undefined && r.whoId === assistantId
          ? "assistant"
          : "agent";
    out.push({
      ...base(),
      key,
      kind: direct ? "dm" : "chat",
      shape,
      title: r.title,
      faces: r.members ? r.members.map((m) => m.id) : r.whoId ? [r.whoId] : [],
      unread: r.unread + (r.repliesUnread ?? 0),
      mentions: s.mentions?.get(key) ?? 0,
      muted: r.muted === true || muted("thread", r.threadId),
      draft: s.drafts?.has(key) === true,
      working: r.working,
      archived: r.archived === true,
      ask: s.asks?.has(r.threadId) === true,
      lastAt: r.lastAt,
      ...(direct && r.whoId && s.presence?.get(r.whoId) ? { presence: s.presence.get(r.whoId)! } : {}),
      ...failedOf(key),
    });
  }
  const projectRecords = new Set((s.projects ?? []).flatMap((p) => (p.recordId ? [p.recordId] : [])));
  for (const c of s.channels) {
    if (c.archived) continue;
    // a project's own channel is the project's Chat tab: with the project row, the channel is not listed again
    if (c.recordId !== undefined && projectRecords.has(c.recordId)) continue;
    const key = `ch:${c.channelId}`;
    out.push({
      ...base(),
      key,
      kind: c.recordId !== undefined ? "project" : "channel",
      shape: c.recordId !== undefined ? "project" : "channel",
      title: c.name,
      unread: c.unread,
      mentions: s.mentions?.get(key) ?? 0,
      muted: muted("channel", c.channelId) || muted("thread", c.mainThreadId),
      private: c.visibility === "invite",
      ...failedOf(key),
    });
  }
  for (const p of s.projects ?? []) {
    if (p.archived) continue;
    const ch = p.recordId === undefined ? undefined : s.channels.find((c) => c.recordId === p.recordId);
    const key = `pj:${p.id}`;
    out.push({
      ...base(),
      key,
      kind: "project",
      shape: "project",
      title: p.title,
      unread: ch?.unread ?? p.unread ?? 0,
      mentions: s.mentions?.get(key) ?? 0,
      muted: ch !== undefined && (muted("channel", ch.channelId) || muted("thread", ch.mainThreadId)),
      ...failedOf(key),
    });
  }
  for (const g of s.goals ?? []) {
    const key = `g:${g.id}`;
    const p = g.progress;
    out.push({
      ...base(),
      key,
      kind: "goal",
      shape: "goal",
      title: g.title,
      faces: [g.leadAgentId],
      working: g.status === "active",
      ended: ENDED.has(g.status),
      progress: { done: p.tasksDone, total: p.tasks },
      lastAt: g.updatedAt,
      ...failedOf(key),
    });
  }
  for (const n of s.needs ?? []) {
    out.push({
      ...base(),
      key: `n:${n.task.id}`,
      kind: "task",
      shape: "task",
      title: n.task.title,
      ...(s.agentName && n.task.createdBy ? { sub: s.agentName(n.task.createdBy) } : {}),
      faces: n.task.createdBy ? [n.task.createdBy] : [],
      verb: needsVerb(n),
    });
  }
  for (const p of s.people ?? []) {
    if (dmWith.has(p.id)) continue;
    out.push({
      ...base(),
      key: `p:${p.id}`,
      kind: "person",
      shape: "person",
      title: p.name,
      faces: [p.id],
      muted: muted("person", p.id),
      ...(s.presence?.get(p.id) ? { presence: s.presence.get(p.id)! } : {}),
    });
  }
  for (const a of [...(s.assistant ? [s.assistant as Agent] : []), ...(s.agents ?? [])]) {
    const isAssistant = a.agentId === assistantId;
    out.push({
      ...base(),
      key: `f:${a.agentId}`,
      kind: "agent",
      shape: isAssistant ? "assistant" : "agent",
      title: a.name,
      faces: [a.agentId],
      muted: muted("agent", a.agentId),
      working: s.workingAgents?.has(a.agentId) === true,
    });
  }
  return out;
}
