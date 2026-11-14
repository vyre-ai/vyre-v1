// The Chats sidebar of the 13 Nov design (team/v1/SIDEBAR-2026-11-13.md, Part 2): the pure part, no drawing and no reads.
// One function, `buildLayout`, turns what the sidebar reads today (as `Item`s, made by `itemsFrom`) into the six blocks in order, each capped, with its one mark per row, the count and marks of a folded
// head, the "N more" that carries what it hides, the filter choices and the rail's one number. It sits beside the old model (`model.ts`) and is switched in at one place; nothing here changes `model.ts`.
import {
  SECTION_ORDER,
  SECTION_LABEL,
  SECTION_WHAT,
  aggOf,
  aggMarks,
  capList,
  markOf,
  railCount,
  sectionsOf,
  showingLine,
  CAPS,
  H,
  MAX_PIN_DIGITS,
} from "../../../../../../lib/sidebar.ts";
import type { Agg, FilterId, Item, ItemKind, Mark, SectionId, Shape } from "../../../../../../lib/sidebar.ts";
export * from "../../../../../../lib/sidebar.ts";
import type { Agent, Channel, ChatRow, MutedFn, NeedsItem } from "./model.ts";
import type { GoalLine } from "../goals/model.ts";
import type { ProjectLine } from "../projects/model.ts";

// ---------------------------------------------------------------- the flat list of entries

export type LayoutEntry = { key: string; y: number; h: number } & (
  | { type: "tasks"; count: number; folded: boolean }
  /** One quiet line in a section with nothing in it: "No goals yet" with its one action. */
  | { type: "hint"; section: SectionId; text: string; action: string }
  | { type: "row"; section: SectionId; item: Item; mark: Mark | null; digit?: number }
  | { type: "head"; section: SectionId; label: string; count: number; folded: boolean; agg: Agg; marks: Mark[] }
  /** "N more": opens in place, except under Needs you, where it opens Tasks. It carries the marks of what it hides. */
  | { type: "more"; section: SectionId; hidden: number; agg: Agg; marks: Mark[]; opens: "place" | "tasks" }
  | { type: "less"; section: SectionId }
  | { type: "error"; section: SectionId; what: string }
  | { type: "none" }
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

/** The six blocks of the sidebar as one flat list of typed entries with fixed heights. */
export function buildLayout(i: LayoutInput): Layout {
  const failed = i.failed ?? new Set<SectionId>();
  const items = i.guest
    ? i.items.filter((x) => x.kind !== "person" && x.kind !== "agent" && x.kind !== "goal")
    : i.items;
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
    // the list arrives as one answer: while it has not, the owner draws the shared quiet mark (Loadable); nothing is drawn per section
    return {
      ...base,
      entries: [],
      height: 0,
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
  const needsFolded = i.folded.has("needs") && !filtered;
  if (!filtered) push({ key: "tasks", type: "tasks", count: sec.needs.length, folded: needsFolded }, H.tasks);
  for (const s of SECTION_ORDER) {
    if (s === "channels" && i.personal === true) continue;
    if ((s === "team" || s === "goals") && i.guest === true) continue;
    const list = sec[s];
    const fail = failed.has(s);
    if (s === "needs") {
      if (needsFolded) continue;
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
    const noGoals = s === "goals" && list.length === 0 && !filtered && !fail;
    if (list.length === 0 && !fail && !noGoals) continue;
    const folded = i.folded.has(s) && !filtered;
    const label = s === "team" && i.personal === true ? "Agents" : SECTION_LABEL[s];
    const agg = aggOf(list);
    push(
      { key: `h:${s}`, type: "head", section: s, label, count: list.length, folded, agg, marks: aggMarks(agg) },
      H.head,
    );
    if (folded) continue;
    if (noGoals) {
      push({ key: "hint:goals", type: "hint", section: s, text: "No goals yet", action: "New goal" }, H.row);
      continue;
    }
    if (fail) {
      push({ key: `e:${s}`, type: "error", section: s, what: SECTION_WHAT[s] }, H.error);
      if (list.length === 0) continue;
    }
    const h = s === "goals" ? H.two : H.row;
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
  /** The live line under a goal: "Editing upload.ts", "Next check-in Wed 9:00". */
  goalLine?: (g: GoalLine) => string;
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
  const dms = new Map<string, ChatRow>();
  const seen = new Set<string>();
  for (const r of s.chats) {
    if (seen.has(r.threadId) || s.goalThreads?.has(r.threadId) === true || r.goalId !== undefined) continue;
    seen.add(r.threadId);
    const key = `c:${r.threadId}`;
    const direct = r.direct === true;
    // a one-to-one is its person's row in Team, not a row of Chats
    if (direct && r.whoId) {
      if (!dms.has(r.whoId)) dms.set(r.whoId, r);
      continue;
    }
    const group = !direct && (r.members !== undefined || (r.withPeople === true && r.kind === "person"));
    const shape: Shape = group ? "group" : r.whoId !== undefined && r.whoId === assistantId ? "assistant" : "agent";
    out.push({
      ...base(),
      key,
      kind: "chat",
      shape,
      title: r.title,
      faces: r.members
        ? r.members.map((m) => ({ id: m.id, name: m.name }))
        : r.whoId
          ? [{ id: r.whoId, name: r.who }]
          : [],
      unread: r.unread + (r.repliesUnread ?? 0),
      mentions: s.mentions?.get(key) ?? 0,
      muted: r.muted === true || muted("thread", r.threadId),
      draft: s.drafts?.has(key) === true,
      working: r.working,
      archived: r.archived === true,
      withPeople: r.withPeople === true,
      ask: s.asks?.has(r.threadId) === true,
      lastAt: r.lastAt,
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
      faces: [{ id: g.leadAgentId, name: s.agentName?.(g.leadAgentId) ?? "Agent" }],
      working: g.status === "active",
      ended: ENDED.has(g.status),
      quiet: g.status !== "active" && !ENDED.has(g.status),
      ...(s.goalLine ? { sub: s.goalLine(g) } : g.statusReason ? { sub: g.statusReason } : {}),
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
      faces: n.task.createdBy ? [{ id: n.task.createdBy, name: s.agentName?.(n.task.createdBy) ?? "Agent" }] : [],
      verb: needsVerb(n),
    });
  }
  const personRow = (id: string, name: string): Item => {
    const dm = dms.get(id);
    const key = dm ? `c:${dm.threadId}` : `p:${id}`;
    const pres = s.presence?.get(id);
    return {
      ...base(),
      key,
      kind: "person",
      shape: "person",
      title: name,
      faces: [{ id, name }],
      muted: muted("person", id) || (dm !== undefined && (dm.muted === true || muted("thread", dm.threadId))),
      ...(dm
        ? {
            threadId: dm.threadId,
            unread: dm.unread + (dm.repliesUnread ?? 0),
            mentions: s.mentions?.get(key) ?? 0,
            draft: s.drafts?.has(key) === true,
            lastAt: dm.lastAt,
            archived: dm.archived === true,
            ...failedOf(key),
          }
        : {}),
      ...(pres ? { presence: pres } : {}),
    };
  };
  const listed = new Set((s.people ?? []).map((p) => p.id));
  for (const p of s.people ?? []) out.push(personRow(p.id, p.name));
  // a one-to-one with someone not in the directory read yet is still that person's row
  for (const [id, dm] of dms) if (!listed.has(id)) out.push(personRow(id, dm.who));
  const agentLast = new Map<string, number>();
  for (const r of s.chats)
    if (r.direct !== true && r.whoId !== undefined && r.members === undefined)
      agentLast.set(r.whoId, Math.max(agentLast.get(r.whoId) ?? 0, r.lastAt));
  for (const a of [...(s.assistant ? [s.assistant as Agent] : []), ...(s.agents ?? [])]) {
    const isAssistant = a.agentId === assistantId;
    out.push({
      ...base(),
      key: `f:${a.agentId}`,
      kind: "agent",
      shape: isAssistant ? "assistant" : "agent",
      title: a.name,
      faces: [{ id: a.agentId, name: a.name }],
      muted: muted("agent", a.agentId),
      assistant: isAssistant,
      working: s.workingAgents?.has(a.agentId) === true,
      lastAt: agentLast.get(a.agentId) ?? 0,
    });
  }
  return out;
}
