// The Chats sidebar's pure rules, shared by the server (the chats.sidebar read) and the app (the list): which block a row belongs to, in what order, how many show, the one mark of a row, the sum of marks, the filters and the
// rail's one badge. No React and no module import: it is data in, data out, so both sides give the same answer (design 13 Nov, team/v1/SIDEBAR-2026-11-13.md Part 2).

// ---------------------------------------------------------------- the words of the design

/** The six blocks, top to bottom. Needs you is the Tasks row with its waiting items under it; the others have a head. */
export type SectionId = "needs" | "goals" | "pinned" | "chats" | "channels" | "team";
export const SECTION_ORDER: readonly SectionId[] = ["needs", "goals", "pinned", "chats", "channels", "team"];
export const SECTION_LABEL: Record<SectionId, string> = {
  needs: "Needs you",
  goals: "Goals",
  pinned: "Pinned",
  chats: "Chats",
  channels: "Channels",
  team: "Team",
};
/** Hard caps (design 2.4): "N more" carries the marks of what it hides, so nothing is hidden silently and nothing pushes the rest away. */
export const CAPS: Record<SectionId, number> = { needs: 3, goals: 3, pinned: 6, chats: 6, channels: 5, team: 5 };
/** What a failed read of a section says it could not load: "Couldn't load chats". */
export const SECTION_WHAT: Record<SectionId, string> = {
  needs: "what needs you",
  goals: "goals",
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
export type ItemKind = "chat" | "channel" | "project" | "goal" | "person" | "agent" | "task";
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
  /** The faces on the row: the one actor, the lead of a goal, the asker of a task, or the first of a group. */
  faces: readonly { id: string; name: string }[];
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
  /** Other people are in this chat: its menu offers Leave, not Delete (delete is only for a chat of me and agents). */
  withPeople?: boolean;
  /** A goal that is not moving (waiting, paused, planning, draft): drawn quieter and listed after the active ones. */
  quiet?: boolean;
  /** A person's one-to-one chat: the row opens it, and its unread, mentions, muted and last activity are that person's. */
  threadId?: string;
  /** The Assistant row of Team: it has no Pause, Edit instructions or Delete. */
  assistant?: boolean;
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
    else if (x.kind === "person" && x.unread > 0) n++;
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

const ORDER_PRESENCE = { online: 0, away: 1 } as const;
const byChats = (a: Item, b: Item): number =>
  Number(a.muted) - Number(b.muted) ||
  b.lastAt - a.lastAt ||
  a.title.localeCompare(b.title) ||
  a.key.localeCompare(b.key);

/** The members of each block after the design's order of precedence: Needs you, then Pinned, then the item's own block. An item shows once. */
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
  const rest = ok.filter((x) => !used.has(x.key));
  // Goals: active first, each with its live line; then the quiet ones (waiting, paused); finished ones only under the filter
  const goalsAll = rest.filter((x) => x.kind === "goal");
  const goals = [...goalsAll.filter((x) => x.quiet !== true), ...goalsAll.filter((x) => x.quiet === true)];
  // a running agent stays a row of Chats with its working ring: there is no Now block
  const chats = rest.filter((x) => x.kind === "chat" || (f === "archived" && x.archived)).sort(byChats);
  const channels = rest
    .filter((x) => x.kind === "channel" || x.kind === "project")
    .map((x, n) => ({ x, n }))
    .sort((a, b) => Number(a.x.muted) - Number(b.x.muted) || a.n - b.n)
    .map((e) => e.x);
  // Team is the whole team the person may reach, most recent first: a one-to-one is that person's row (Chats never repeats it)
  const team = rest
    .filter((x) => x.kind === "person" || x.kind === "agent")
    .sort(
      (a, b) =>
        b.lastAt - a.lastAt ||
        Number(b.kind === "person") - Number(a.kind === "person") ||
        (ORDER_PRESENCE[a.presence ?? "away"] ?? 2) - (ORDER_PRESENCE[b.presence ?? "away"] ?? 2) ||
        a.title.localeCompare(b.title) ||
        a.key.localeCompare(b.key),
    );
  return { needs, goals, pinned, chats, channels, team };
}

/** The first `cap` of a list; the open row, if cut, swaps in for the last shown. The rest is what "N more" holds. */
export function capList(list: readonly Item[], cap: number, open: string | null): { shown: Item[]; hidden: Item[] } {
  if (list.length <= cap) return { shown: [...list], hidden: [] };
  let shown = list.slice(0, cap);
  const op = open === null ? undefined : list.find((x) => x.key === open);
  if (op && !shown.includes(op)) shown = [...shown.slice(0, cap - 1), op];
  return { shown, hidden: list.filter((x) => !shown.includes(x)) };
}
