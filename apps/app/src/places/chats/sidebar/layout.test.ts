// The new Chats sidebar's model (design 13 Nov, Part 2): sections in order, caps, the one mark, folded sums, filters, the rail's one number. Table-driven from the design's own examples; no renderer.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPS,
  FILTER_CHOICES,
  aggMarks,
  aggOf,
  buildLayout,
  capList,
  filterChoices,
  itemsFrom,
  markOf,
  needsVerb,
  passes,
  railCount,
  sectionsOf,
  showingLine,
} from "./layout.ts";
import type { FilterId, Item, ItemKind, LayoutEntry, LayoutInput, SectionId, Shape } from "./layout.ts";
import type { Agent, Channel, ChatRow, NeedsItem } from "./model.ts";

let seq = 0;
const mk = (kind: ItemKind, o: Partial<Item> = {}): Item => {
  const n = ++seq;
  const shape: Shape = (
    {
      chat: "agent",
      dm: "person",
      channel: "channel",
      project: "project",
      goal: "goal",
      person: "person",
      agent: "agent",
      task: "task",
    } as const
  )[kind];
  return {
    key: `${kind}:${n}`,
    kind,
    shape,
    title: `${kind} ${n}`,
    faces: [],
    unread: 0,
    mentions: 0,
    muted: false,
    draft: false,
    working: false,
    archived: false,
    ask: false,
    ended: false,
    lastAt: 1000 - n,
    ...o,
  };
};
const many = (n: number, kind: ItemKind, o: (i: number) => Partial<Item> = () => ({})): Item[] =>
  Array.from({ length: n }, (_, i) => mk(kind, o(i)));
const input = (items: readonly Item[], o: Partial<LayoutInput> = {}): LayoutInput => ({
  items,
  pins: [],
  filter: "all",
  folded: new Set<SectionId>(),
  more: new Set<SectionId>(),
  open: null,
  ...o,
});
const rows = (es: readonly LayoutEntry[], s: SectionId): Item[] =>
  es.flatMap((e) => (e.type === "row" && e.section === s ? [e.item] : []));
const types = (es: readonly LayoutEntry[]): string[] =>
  es.map((e) => e.type + (e.type === "head" ? `:${e.section}` : ""));
const entry = <T extends LayoutEntry["type"]>(es: readonly LayoutEntry[], type: T, section?: SectionId) =>
  es.find((e) => e.type === type && (section === undefined || ("section" in e && e.section === section))) as
    | Extract<LayoutEntry, { type: T }>
    | undefined;

// ---------------------------------------------------------------- the one mark, by importance

const MARK_TABLE: { name: string; o: Partial<Item>; want: string | null }[] = [
  { name: "nothing", o: {}, want: null },
  {
    name: "failed beats everything",
    o: { failed: "Stopped", muted: true, mentions: 3, unread: 2, draft: true, working: true },
    want: "failed",
  },
  {
    name: "muted shows nothing else, even a mention",
    o: { muted: true, mentions: 2, unread: 1, draft: true, working: true },
    want: "muted",
  },
  { name: "a mention count beats unread", o: { mentions: 2, unread: 5, draft: true }, want: "mention" },
  { name: "unread beats a draft", o: { unread: 1, draft: true, working: true }, want: "unread" },
  { name: "a draft beats working", o: { draft: true, working: true }, want: "draft" },
  { name: "working last", o: { working: true }, want: "working" },
];
for (const c of MARK_TABLE)
  test(`one mark: ${c.name}`, () => assert.equal(markOf(mk("chat", c.o))?.kind ?? null, c.want));

test("a task draws its verb, never a mark", () => assert.equal(markOf(mk("task", { unread: 3 })), null));

test("a muted chat with a mention: the muted bell shows, nothing counts toward heads or the rail", () => {
  const x = mk("dm", { muted: true, mentions: 2, unread: 1 });
  assert.deepEqual(markOf(x), { kind: "muted" });
  assert.deepEqual(aggOf([x]), { failed: 0, mentions: 0, unread: 0, working: 0 });
  assert.equal(railCount([x]), 0);
  const l = buildLayout(input([x]));
  assert.equal(entry(l.entries, "row")!.mark!.kind, "muted");
});

// ---------------------------------------------------------------- sums when folded and under "N more"

test("a folded head carries its count and the sum of its marks", () => {
  const items = [
    mk("chat", { unread: 1 }),
    mk("chat", { mentions: 2 }),
    mk("chat", { mentions: 1 }),
    mk("chat", { failed: "Stopped" }),
    mk("chat", { muted: true, mentions: 9 }),
  ];
  const l = buildLayout(input(items, { folded: new Set<SectionId>(["chats"]) }));
  const h = entry(l.entries, "head", "chats")!;
  assert.equal(h.folded, true);
  assert.equal(h.count, 5);
  assert.deepEqual(h.agg, { failed: 1, mentions: 3, unread: 1, working: 0 });
  assert.deepEqual(h.marks, [{ kind: "failed" }, { kind: "mention", count: 3 }]);
  assert.equal(rows(l.entries, "chats").length, 0, "a folded head draws no rows");
});

test("aggMarks: red circle, then a mention count, else an unread dot, else working", () => {
  assert.deepEqual(aggMarks({ failed: 0, mentions: 0, unread: 2, working: 1 }), [{ kind: "unread" }]);
  assert.deepEqual(aggMarks({ failed: 0, mentions: 0, unread: 0, working: 1 }), [{ kind: "working" }]);
  assert.deepEqual(aggMarks({ failed: 0, mentions: 0, unread: 0, working: 0 }), []);
});

test("the section fold is ignored under a filter: everything shows", () => {
  const items = [mk("chat", { unread: 1 })];
  const l = buildLayout(input(items, { filter: "unread", folded: new Set<SectionId>(["chats"]) }));
  assert.equal(rows(l.entries, "chats").length, 1);
});

test('"N more" carries the marks of what it hides', () => {
  const items = many(10, "chat", (i) => (i === 9 ? { failed: "Stopped" } : i === 8 ? { mentions: 2 } : {}));
  const l = buildLayout(input(items));
  const m = entry(l.entries, "more", "chats")!;
  assert.equal(m.hidden, 4);
  assert.deepEqual(m.marks, [{ kind: "failed" }, { kind: "mention", count: 2 }]);
  assert.equal(m.opens, "place");
});

test('"N more" opens in place, remembered by the caller; then the list ends with "Show less"', () => {
  const items = many(10, "chat");
  const l = buildLayout(input(items, { more: new Set<SectionId>(["chats"]) }));
  assert.equal(rows(l.entries, "chats").length, 10);
  assert.equal(entry(l.entries, "more", "chats"), undefined);
  assert.ok(entry(l.entries, "less", "chats"));
});

// ---------------------------------------------------------------- caps, with the design's busy Space

test("40 channels and 60 chats: every cap holds, the count behind 'N more' is exact, nothing is pushed off", () => {
  const items = [
    ...many(60, "chat"),
    ...many(40, "channel"),
    ...many(25, "agent", () => ({ presence: "away" as const })),
    ...many(12, "person"),
    ...many(9, "task", () => ({ verb: { label: "Allow", tone: "accent" as const } })),
  ];
  const l = buildLayout(input(items));
  const want: [SectionId, number, number][] = [
    ["needs", CAPS.needs, 9],
    ["chats", CAPS.chats, 60],
    ["channels", CAPS.channels, 40],
    ["team", CAPS.team, 37],
  ];
  for (const [s, cap, total] of want) {
    assert.equal(rows(l.entries, s).length, cap, `${s} shows its cap`);
    assert.equal(entry(l.entries, "more", s)!.hidden, total - cap, `${s} says how many are behind`);
  }
  assert.equal(entry(l.entries, "more", "needs")!.opens, "tasks", "Needs you opens Tasks, not in place");
  // heads in order, each once: the six blocks stay in view order
  assert.deepEqual(
    types(l.entries).filter((t) => t.startsWith("head")),
    ["head:chats", "head:channels", "head:team"],
  );
  // the whole list is a few dozen rows tall, not 100+
  assert.ok(l.entries.length <= 1 + 3 + 6 + 5 + 5 + 3 * 2 + 3, `drew ${l.entries.length}`);
  // fixed heights, contiguous offsets, so the window needs no measuring
  let y = 0;
  for (const e of l.entries) {
    assert.equal(e.y, y);
    y += e.h;
  }
  assert.equal(l.height, y);
});

test("the open row is always drawn: it swaps in for the last shown", () => {
  const items = many(10, "channel");
  const open = items[8]!.key;
  const l = buildLayout(input(items, { open }));
  const shown = rows(l.entries, "channels");
  assert.equal(shown.length, CAPS.channels);
  assert.equal(shown[shown.length - 1]!.key, open);
  assert.equal(entry(l.entries, "more", "channels")!.hidden, 5);
});

test("capList keeps list order and never exceeds the cap", () => {
  const xs = many(8, "chat");
  const { shown, hidden } = capList(xs, 6, xs[7]!.key);
  assert.equal(shown.length, 6);
  assert.deepEqual(shown.slice(0, 5), xs.slice(0, 5));
  assert.equal(hidden.length, 2);
});

test("Needs you shows the first three waiting items, each with its one verb; the rest wait behind Tasks", () => {
  const verbs = ["Allow", "Review", "Blocked", "Answer"];
  const tasks = verbs.map((v, n) =>
    mk("task", { title: `t${n}`, verb: { label: v, tone: v === "Blocked" ? "warn" : "accent" } }),
  );
  const l = buildLayout(input(tasks));
  assert.equal(entry(l.entries, "tasks")!.count, 4, "the Tasks count is every waiting item");
  assert.deepEqual(
    rows(l.entries, "needs").map((x) => x.verb!.label),
    ["Allow", "Review", "Blocked"],
  );
  assert.equal(entry(l.entries, "more", "needs")!.hidden, 1);
  assert.ok(!types(l.entries).includes("head:needs"), "Needs you has no head; the Tasks row is its head");
  assert.equal(entry(l.entries, "row", "needs")!.h, 44, "a two-line row");
});

// ---------------------------------------------------------------- where an item shows, once

test("a goal that is active and pinned shows once, in Pinned, not in Now", () => {
  const g = mk("goal", { working: true, progress: { done: 3, total: 7 } });
  const l = buildLayout(input([g, mk("goal")], { pins: [g.key] }));
  const all = l.entries.flatMap((e) => (e.type === "row" ? [e.item.key] : []));
  assert.equal(all.filter((k) => k === g.key).length, 1);
  assert.ok(rows(l.entries, "pinned").some((x) => x.key === g.key));
  assert.ok(!rows(l.entries, "now").some((x) => x.key === g.key));
});

test("precedence: Needs you, then Pinned, then Now, then its own block", () => {
  const working = mk("chat", { working: true });
  const pinnedWorking = mk("chat", { working: true });
  const plain = mk("chat");
  const s = sectionsOf([working, pinnedWorking, plain], [pinnedWorking.key], "all");
  assert.deepEqual(
    s.pinned.map((x) => x.key),
    [pinnedWorking.key],
  );
  assert.deepEqual(
    s.now.map((x) => x.key),
    [working.key],
  );
  assert.deepEqual(
    s.chats.map((x) => x.key),
    [plain.key],
  );
});

test("Now holds a chat mid-task and every goal that has not ended; ended goals wait under Filter, Goals", () => {
  const items = [mk("chat", { working: true }), mk("goal"), mk("goal", { ended: true })];
  const s = sectionsOf(items, [], "all");
  assert.equal(s.now.length, 2);
  assert.ok(!s.now.some((x) => x.ended));
  const only = sectionsOf(items, [], "goals").now;
  assert.equal(only.length, 2, "the Goals filter lists goals only");
  assert.ok(
    only.some((x) => x.ended),
    "and the ended one is among them",
  );
});

test("Pinned keeps the person's own order, not recency", () => {
  const [a, b, c] = many(3, "chat");
  const s = sectionsOf([a!, b!, c!], [c!.key, a!.key], "all");
  assert.deepEqual(
    s.pinned.map((x) => x.key),
    [c!.key, a!.key],
  );
});

test("Chats are newest first with muted ones last; Channels keep the Space's order, muted last; Team puts people first, online first", () => {
  const old = mk("chat", { lastAt: 1 });
  const fresh = mk("chat", { lastAt: 9 });
  const quiet = mk("chat", { lastAt: 99, muted: true });
  assert.deepEqual(
    sectionsOf([old, quiet, fresh], [], "all").chats.map((x) => x.key),
    [fresh.key, old.key, quiet.key],
  );
  const c1 = mk("channel", { muted: true });
  const c2 = mk("channel");
  assert.deepEqual(
    sectionsOf([c1, c2], [], "all").channels.map((x) => x.key),
    [c2.key, c1.key],
  );
  const ag = mk("agent", { working: true });
  const away = mk("person", { presence: "away" });
  const on = mk("person", { presence: "online" });
  assert.deepEqual(
    sectionsOf([ag, away, on], [], "all").team.map((x) => x.key),
    [on.key, away.key, ag.key],
  );
});

test("Pinned, Team and Needs you rows are the first nine of the pin order for Cmd-1 to Cmd-9", () => {
  const items = many(12, "chat");
  const l = buildLayout(input(items, { pins: items.map((x) => x.key) }));
  assert.equal(l.digits.size, 9);
  assert.equal(l.digits.get(items[0]!.key), 1);
  assert.equal(l.digits.get(items[8]!.key), 9);
  assert.equal(l.digits.get(items[9]!.key), undefined);
  assert.equal(entry(l.entries, "row", "pinned")!.digit, 1);
});

// ---------------------------------------------------------------- the first minute, a guest, a Personal Space

test("an empty Space: one invitation, no headings, no Tasks row, no Notes & artifacts row", () => {
  const l = buildLayout(input([], { setup: { done: 1, total: 6 } }));
  assert.equal(l.empty, true);
  assert.deepEqual(l.entries, []);
  assert.equal(l.foot.notes, null);
  assert.deepEqual(l.foot.setup, { done: 1, total: 6 }, "Finish setup stays at the foot");
});

test("a failed read is not an empty Space", () => {
  const l = buildLayout(input([], { failed: new Set<SectionId>(["chats"]) }));
  assert.equal(l.empty, false);
});

test("a guest has no Team section and none of its rows", () => {
  const items = [mk("chat"), mk("channel"), mk("person"), mk("agent")];
  const l = buildLayout(input(items, { guest: true }));
  assert.ok(!types(l.entries).includes("head:team"));
  assert.ok(!l.entries.some((e) => e.type === "row" && (e.item.kind === "person" || e.item.kind === "agent")));
  assert.ok(types(l.entries).includes("head:chats"));
  assert.ok(types(l.entries).includes("head:channels"));
});

test("a Personal Space has no Channels and calls Team Agents", () => {
  const l = buildLayout(input([mk("chat"), mk("agent")], { personal: true }));
  assert.ok(!types(l.entries).includes("head:channels"));
  assert.equal(entry(l.entries, "head", "team")!.label, "Agents");
});

test("a Space with chats shows Tasks, then Chats; Now, Pinned and Channels show only when they have something", () => {
  const l = buildLayout(input([mk("chat")]));
  assert.deepEqual(types(l.entries), ["tasks", "head:chats", "row"]);
  assert.equal(l.foot.notes?.new, 0);
});

// ---------------------------------------------------------------- loading and failing, per section

test("loading draws quiet rows at real heights and no rail number", () => {
  const l = buildLayout(input([], { loading: true }));
  assert.equal(l.loading, true);
  assert.ok(l.entries.every((e) => e.type === "skeleton"));
  assert.equal(l.rail, 0);
  assert.ok(l.entries.some((e) => e.type === "skeleton" && !e.head && e.h === 32));
});

test("one section failing keeps its head and says so with Retry; the others draw", () => {
  const items = [mk("chat"), mk("channel"), mk("channel")];
  const l = buildLayout(input(items, { failed: new Set<SectionId>(["chats"]) }));
  const t = types(l.entries);
  assert.deepEqual(t.slice(t.indexOf("head:chats"), t.indexOf("head:chats") + 3), ["head:chats", "error", "row"]);
  assert.equal(entry(l.entries, "error", "chats")!.what, "chats");
  assert.equal(rows(l.entries, "channels").length, 2);
  const none = buildLayout(input([mk("channel")], { failed: new Set<SectionId>(["chats"]) }));
  assert.ok(types(none.entries).includes("head:chats"), "a failed section with nothing to show still has its head");
});

// ---------------------------------------------------------------- filters

const FILTER_TABLE: { f: FilterId; items: () => Item[]; want: number }[] = [
  {
    f: "unread",
    items: () => [
      mk("chat", { unread: 1 }),
      mk("chat", { mentions: 1 }),
      mk("chat", { unread: 1, muted: true }),
      mk("chat"),
    ],
    want: 2,
  },
  { f: "mentions", items: () => [mk("chat", { mentions: 2 }), mk("chat", { unread: 1 })], want: 1 },
  { f: "working", items: () => [mk("chat", { working: true }), mk("agent", { working: true }), mk("chat")], want: 2 },
  { f: "needs", items: () => [mk("task"), mk("task"), mk("chat")], want: 2 },
  { f: "failed", items: () => [mk("chat", { failed: "x" }), mk("chat")], want: 1 },
  { f: "muted", items: () => [mk("chat", { muted: true }), mk("channel", { muted: true }), mk("chat")], want: 2 },
  { f: "goals", items: () => [mk("goal"), mk("goal", { ended: true }), mk("chat")], want: 2 },
  { f: "asks", items: () => [mk("chat", { ask: true }), mk("chat")], want: 1 },
  { f: "archived", items: () => [mk("chat", { archived: true }), mk("chat")], want: 1 },
  {
    f: "all",
    items: () => [mk("chat", { archived: true }), mk("chat", { ask: true }), mk("goal", { ended: true }), mk("chat")],
    want: 1,
  },
];
for (const c of FILTER_TABLE)
  test(`filter ${c.f}`, () => {
    const items = c.items();
    assert.equal(items.filter((x) => passes(x, c.f)).length, c.want);
    assert.equal(filterChoices(items).find((x) => x.id === c.f)!.count, c.want);
  });

test("the filter menu is Show, then Only, and every choice has a count", () => {
  assert.deepEqual(
    FILTER_CHOICES.map((c) => `${c.group}:${c.id}`),
    [
      "show:all",
      "show:unread",
      "show:mentions",
      "show:working",
      "show:needs",
      "show:failed",
      "show:muted",
      "only:goals",
      "only:asks",
      "only:archived",
    ],
  );
});

test("Showing line: 'Showing Unread, 6'; none for Everything", () => {
  const items = many(6, "chat", () => ({ unread: 1 }));
  assert.deepEqual(showingLine(items, "unread"), { text: "Showing Unread, 6", count: 6 });
  assert.equal(showingLine(items, "all"), null);
  assert.equal(buildLayout(input(items, { filter: "unread" })).filter.showing!.text, "Showing Unread, 6");
});

test("under a filter there are no caps and no Tasks row; a filter that finds nothing says so", () => {
  const items = many(20, "chat", () => ({ unread: 1 }));
  const l = buildLayout(input(items, { filter: "unread" }));
  assert.equal(rows(l.entries, "chats").length, 20);
  assert.ok(!l.entries.some((e) => e.type === "tasks" || e.type === "more"));
  const e = buildLayout(input([mk("chat")], { filter: "failed" }));
  assert.deepEqual(types(e.entries), ["none"]);
});

// ---------------------------------------------------------------- the rail's one badge

test("rail: every waiting task, plus mentions, plus a new direct message; plain unread is not counted", () => {
  const items = [
    mk("task"),
    mk("task"),
    mk("chat", { mentions: 2 }),
    mk("dm", { unread: 4 }),
    mk("dm", { unread: 1, mentions: 1 }),
    mk("chat", { unread: 9 }),
    mk("channel", { unread: 3 }),
    mk("chat", { muted: true, mentions: 5 }),
    mk("chat", { archived: true, mentions: 5 }),
  ];
  assert.equal(railCount(items), 2 + 2 + 1 + 1);
  assert.equal(buildLayout(input(items)).rail, 6);
});

test("the rail equals the sum of the sidebar's Tasks count, mention badges and direct-message dots", () => {
  const items = [
    mk("task"),
    mk("chat", { mentions: 2 }),
    mk("dm", { unread: 1 }),
    mk("channel", { mentions: 1 }),
    mk("chat", { unread: 5 }),
  ];
  const l = buildLayout(input(items, { pins: [] }));
  const mentionBadges = l.entries.reduce(
    (n, e) => n + (e.type === "row" && e.mark?.kind === "mention" ? e.mark.count : 0),
    0,
  );
  const dmDots = l.entries.reduce(
    (n, e) => n + (e.type === "row" && e.item.kind === "dm" && e.mark?.kind === "unread" ? 1 : 0),
    0,
  );
  assert.equal(l.rail, l.tasksCount + mentionBadges + dmDots);
});

// ---------------------------------------------------------------- from today's reads

const chatRow = (o: Partial<ChatRow> & { threadId: string }): ChatRow => ({
  title: o.threadId,
  who: "x",
  kind: "agent",
  unread: 0,
  working: false,
  starred: false,
  lastAt: 1,
  local: false,
  ...o,
});
const channel = (o: Partial<Channel> & { channelId: string }): Channel =>
  ({
    mainThreadId: `th_${o.channelId}`,
    name: o.channelId,
    visibility: "public",
    archived: false,
    members: [],
    agents: [],
    unread: 0,
    ...o,
  }) as Channel;
const need = (id: string, kind: string, blocked = false): NeedsItem =>
  ({ task: { id, title: id, kind, blocked, createdBy: "agt_1" } }) as unknown as NeedsItem;

test("itemsFrom: shapes by who a chat is with; the Assistant is one shape everywhere", () => {
  const items = itemsFrom({
    assistant: { agentId: "assistant", name: "Assistant" },
    chats: [
      chatRow({ threadId: "a", whoId: "assistant" }),
      chatRow({ threadId: "b", whoId: "agt_1" }),
      chatRow({
        threadId: "c",
        whoId: "agt_1",
        members: [
          { id: "agt_1", name: "A" },
          { id: "agt_2", name: "B" },
        ],
      }),
      chatRow({ threadId: "d", kind: "person", whoId: "per_1", direct: true, withPeople: true }),
    ],
    channels: [],
    agents: [{ agentId: "agt_1", name: "Ember" } as Agent],
  });
  const shape = (k: string): string => items.find((x) => x.key === k)!.shape;
  assert.equal(shape("c:a"), "assistant");
  assert.equal(shape("c:b"), "agent");
  assert.equal(shape("c:c"), "group");
  assert.equal(shape("c:d"), "person");
  assert.equal(items.find((x) => x.key === "c:d")!.kind, "dm");
  assert.equal(shape("f:assistant"), "assistant", "the Team row and the chat row are the same shape");
});

test("itemsFrom: an actor shows once: a person with a direct message is that row; a goal's chat is the Goal row", () => {
  const items = itemsFrom({
    chats: [
      chatRow({ threadId: "d", kind: "person", whoId: "per_1", direct: true, withPeople: true }),
      chatRow({ threadId: "gc", goalId: "g1" }),
    ],
    channels: [],
    people: [
      { id: "per_1", name: "Sara" },
      { id: "per_2", name: "Omar" },
    ],
    goals: [
      {
        id: "g1",
        title: "G",
        status: "active",
        leadAgentId: "agt_1",
        updatedAt: 1,
        progress: { tasksDone: 2, tasks: 5 },
      } as never,
    ],
  });
  assert.deepEqual(
    items.filter((x) => x.kind === "person").map((x) => x.title),
    ["Omar"],
  );
  assert.ok(!items.some((x) => x.key === "c:gc"));
  const g = items.find((x) => x.kind === "goal")!;
  assert.deepEqual(g.progress, { done: 2, total: 5 });
  assert.equal(g.working, true);
});

test("itemsFrom: a project is its own row and its channel is not listed twice; without project lines the channel is a project row", () => {
  const chs = [channel({ channelId: "c1" }), channel({ channelId: "cp", recordId: "rec1", unread: 2 })];
  const withProject = itemsFrom({
    chats: [],
    channels: chs,
    projects: [{ id: "p1", recordId: "rec1", title: "Rivera", starred: false, archived: false }],
  });
  assert.deepEqual(withProject.map((x) => x.key).sort(), ["ch:c1", "pj:p1"]);
  assert.equal(withProject.find((x) => x.key === "pj:p1")!.unread, 2);
  const without = itemsFrom({ chats: [], channels: chs });
  assert.equal(without.find((x) => x.key === "ch:cp")!.shape, "project");
});

test("itemsFrom: muted, failed, draft and mention come from the maps", () => {
  const items = itemsFrom({
    chats: [chatRow({ threadId: "a" }), chatRow({ threadId: "b" })],
    channels: [channel({ channelId: "z", unread: 1 })],
    muted: (k, id) => k === "thread" && id === "a",
    failed: new Map([["c:b", "The AI provider did not answer"]]),
    drafts: new Set(["c:b"]),
    mentions: new Map([["ch:z", 2]]),
  });
  assert.equal(markOf(items.find((x) => x.key === "c:a")!)?.kind, "muted");
  assert.deepEqual(markOf(items.find((x) => x.key === "c:b")!), {
    kind: "failed",
    why: "The AI provider did not answer",
  });
  assert.deepEqual(markOf(items.find((x) => x.key === "ch:z")!), { kind: "mention", count: 2 });
});

test("needsVerb: Allow, Review, Answer, Blocked, Sign", () => {
  assert.equal(needsVerb(need("a", "approve")).label, "Allow");
  assert.equal(needsVerb(need("a", "review")).label, "Review");
  assert.equal(needsVerb(need("a", "answer")).label, "Answer");
  assert.deepEqual(needsVerb(need("a", "unblock")), { label: "Blocked", tone: "warn" });
  assert.equal(needsVerb(need("a", "work", true)).label, "Blocked");
  assert.equal(needsVerb(need("a", "signature")).label, "Sign");
});
