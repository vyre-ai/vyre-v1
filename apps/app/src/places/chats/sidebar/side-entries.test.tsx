// The new sidebar's entries drawn: every kind of row by its shape with its one mark, a cut name readable in full, folded heads and "N more" carrying marks, section errors with Retry, loading at real heights.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildLayout } from "./layout.ts";
import type { Item, ItemKind, LayoutEntry, LayoutInput, SectionId, Shape } from "./layout.ts";
import {
  ErrorView,
  HeadView,
  HintView,
  ItemRow,
  LessView,
  MoreView,
  NoneView,
  SkeletonView,
  TasksRow,
  tipOf,
  tipText,
} from "./SideEntries.tsx";

const mk = (kind: ItemKind, shape: Shape, o: Partial<Item> = {}): Item => ({
  key: `${kind}:1`,
  kind,
  shape,
  title: "Launch crew",
  faces: [{ id: "agt_1", name: "Ember" }],
  unread: 0,
  mentions: 0,
  muted: false,
  draft: false,
  working: false,
  archived: false,
  ask: false,
  ended: false,
  lastAt: 1,
  ...o,
});
const layoutOf = (items: Item[], o: Partial<LayoutInput> = {}) =>
  buildLayout({
    items,
    pins: [],
    filter: "all",
    folded: new Set<SectionId>(),
    more: new Set<SectionId>(),
    open: null,
    ...o,
  });
const entryOf = <T extends LayoutEntry["type"]>(l: ReturnType<typeof layoutOf>, type: T, section?: SectionId) =>
  l.entries.find(
    (e) => e.type === type && (section === undefined || ("section" in e && e.section === section)),
  ) as Extract<LayoutEntry, { type: T }>;
const st = { selected: false, cursor: false };
const on = { press: () => {} };
const row = (x: Item, o: Partial<LayoutInput> = {}, state = st, handlers = on): string => {
  const l = layoutOf([x], o);
  return renderToStaticMarkup(<ItemRow entry={entryOf(l, "row")} state={state} on={handlers} />);
};

const SHAPES: { name: string; x: Item; has: RegExp[]; hasNot?: RegExp[] }[] = [
  {
    name: "person: a marble with presence",
    x: mk("person", "person", {
      faces: [{ id: "usr_1", name: "Sara Malik" }],
      presence: "online",
      title: "Sara Malik",
    }),
    has: [/data-testid="face-Sara Malik"/, /data-testid="presence"/],
  },
  {
    name: "person away: the away ring",
    x: mk("person", "person", { faces: [{ id: "usr_1", name: "Omar Reyes" }], presence: "away", title: "Omar Reyes" }),
    has: [/data-testid="presence-away"/],
  },
  {
    name: "agent: a face",
    x: mk("chat", "agent"),
    has: [/data-testid="face-Ember"/],
    hasNot: [/data-testid="face-stack"/, /goal-ring/],
  },
  {
    name: "assistant: the same tile as a face call, by its kind",
    x: mk("chat", "assistant", { faces: [{ id: "assistant", name: "Assistant" }] }),
    has: [/data-testid="face-Assistant"/],
  },
  {
    name: "group: two overlapping faces",
    x: mk("chat", "group", {
      faces: [
        { id: "a", name: "Ember" },
        { id: "b", name: "Mira" },
        { id: "c", name: "Sol" },
      ],
    }),
    has: [/data-testid="face-stack"/],
  },
  {
    name: "channel: hash in an outlined square",
    x: mk("channel", "channel", { title: "launch" }),
    has: [/<svg[^>]*viewBox="0 0 16 16"/],
    hasNot: [/data-testid="face-/],
  },
  {
    name: "project: a filled tile",
    x: mk("project", "project", { title: "Rivera account" }),
    has: [/<svg/],
    hasNot: [/data-testid="face-/],
  },
  {
    name: "goal: the lead's face in a progress ring",
    x: mk("goal", "goal", { title: "300 signups", progress: { done: 212, total: 300 } }),
    has: [/data-testid="goal-ring"/, /data-progress="71"/, /data-testid="avatar-Ember"/],
  },
];
for (const c of SHAPES)
  test(`shape: ${c.name}`, () => {
    const html = row(c.x);
    for (const re of c.has) assert.match(html, re);
    for (const re of c.hasNot ?? []) assert.doesNotMatch(html, re);
  });

test("a goal that is done draws its ring complete; one that is working shows the live dot", () => {
  const done = row(mk("goal", "goal", { ended: true, progress: { done: 5, total: 5 } }), { filter: "goals" });
  assert.match(done, /data-progress="100"/);
  assert.match(done, /var\(--ok\)/);
  assert.match(row(mk("goal", "goal", { working: true, progress: { done: 1, total: 4 } })), /data-testid="goal-live"/);
});

const MARKS: { name: string; o: Partial<Item>; id: string | null }[] = [
  { name: "failed", o: { failed: "The AI provider did not answer" }, id: "mark-failed" },
  { name: "muted", o: { muted: true, mentions: 3 }, id: "mark-muted" },
  { name: "mention", o: { mentions: 2, unread: 4 }, id: "mark-mention" },
  { name: "unread", o: { unread: 1 }, id: "mark-unread" },
  { name: "draft", o: { draft: true }, id: "mark-draft" },
  { name: "working draws no mark, the face ring is it", o: { working: true }, id: null },
  { name: "nothing", o: {}, id: null },
];
for (const c of MARKS)
  test(`one mark: ${c.name}`, () => {
    const html = row(mk("chat", "agent", c.o));
    const found = html.match(/data-testid="mark-[a-z]+"/g) ?? [];
    assert.deepEqual(found, c.id === null ? [] : [`data-testid="${c.id}"`], "never more than one mark");
  });

test("the mention count is a number in an accent badge; a failed run says why for a screen reader", () => {
  const html = row(mk("chat", "agent", { mentions: 2 }));
  assert.match(html, /aria-label="2 mentions"/);
  assert.match(html, />2</);
  assert.match(
    row(mk("chat", "agent", { failed: "Stopped: the AI provider did not answer" })),
    /Failed: Stopped: the AI provider did not answer/,
  );
});

test("a working chat's face wears the moving ring; a waiting task's face wears the amber ring", () => {
  assert.match(row(mk("chat", "agent", { working: true })), /vyre-working|data-state="working"|working/);
  const task = mk("task", "task", {
    verb: { label: "Allow", tone: "accent" },
    sub: "Docs is holding the send",
    title: "Send 12 invoices",
  });
  const html = row(task);
  assert.match(html, /waiting/);
});

test("a Needs you row is two lines with its verb; Blocked is amber; Goals rows are two lines; others one", () => {
  const task = mk("task", "task", {
    verb: { label: "Blocked", tone: "warn" },
    sub: "Sol needs a key to continue",
    title: "Migrate old files",
  });
  const html = row(task);
  assert.match(html, /Migrate old files/);
  assert.match(html, /Sol needs a key to continue/);
  assert.match(html, /data-testid="row-verb"[^>]*>Blocked</);
  assert.match(html, /height:44px/);
  const working = mk("chat", "agent", { working: true, sub: "Editing upload.ts", title: "Client portal launch" });
  assert.match(row(working), /Editing upload\.ts/);
  assert.match(row(mk("chat", "agent")), /height:32px/);
  assert.doesNotMatch(row(mk("chat", "agent")), /height:44px/);
});

test("a name is never cut without a way to read it: the full name and who it is on hover, and the row says it to a screen reader", () => {
  const long = mk("goal", "goal", {
    title: "Close every onboarding task for new clients and send the welcome pack",
    progress: { done: 9, total: 14 },
  });
  const html = row(long);
  assert.match(html, /title="Close every onboarding task for new clients and send the welcome pack\nGoal · 9 of 14"/);
  assert.match(
    html,
    /aria-label="Close every onboarding task for new clients and send the welcome pack, Goal · 9 of 14"/,
  );
  assert.equal(tipOf(mk("chat", "agent", { failed: "Stopped" })).who, "Agent · Stopped");
  assert.equal(tipOf(mk("channel", "channel", { private: true })).who, "Private channel");
  assert.equal(tipOf(mk("person", "person")).who, "Person");
  assert.equal(tipText(mk("chat", "agent", { muted: true })), "Launch crew\nAgent · Muted");
});

test("an unread row is bold, a muted one is not; the open row is selected; the cursor row is drawn as a hover, never as the selection", () => {
  assert.match(row(mk("chat", "agent", { unread: 1 })), /font-weight:(600|bold)/);
  assert.doesNotMatch(row(mk("chat", "agent", { muted: true, unread: 1 })), /font-weight:(600|bold)/);
  assert.match(row(mk("chat", "agent"), {}, { selected: true, cursor: false }), /var\(--sel\)/);
  const cur = row(mk("chat", "agent"), {}, { selected: false, cursor: true });
  assert.match(cur, /var\(--hover\)/);
  assert.doesNotMatch(cur, /var\(--sel\)/);
});

test('a pinned row shows its Cmd digit; the "..." button is there for the menu and says whose', () => {
  const x = mk("chat", "agent");
  const l = layoutOf([x], { pins: [x.key] });
  const html = renderToStaticMarkup(
    <ItemRow entry={entryOf(l, "row")} state={st} on={{ press: () => {}, more: () => {} }} />,
  );
  assert.match(html, /data-testid="digit-1"/);
  assert.match(html, /aria-label="More for Launch crew"/);
});

// ---------------------------------------------------------------- the other entries

test("Tasks: its count in an accent badge; none when nothing waits", () => {
  const withCount = layoutOf([mk("task", "task", { verb: { label: "Allow", tone: "accent" } }), mk("chat", "agent")]);
  const html = renderToStaticMarkup(<TasksRow entry={entryOf(withCount, "tasks")} state={st} on={on} />);
  assert.match(html, /aria-label="Tasks, 1 need you"/);
  assert.match(html, /data-testid="mark-mention"/);
  const none = renderToStaticMarkup(
    <TasksRow entry={entryOf(layoutOf([mk("chat", "agent")]), "tasks")} state={st} on={on} />,
  );
  assert.doesNotMatch(none, /mark-mention/);
});

test("a folded head shows its count and the sum of its marks; an open head shows neither", () => {
  const xs = [
    mk("chat", "agent", { key: "c:1", mentions: 2 }),
    mk("chat", "agent", { key: "c:2", failed: "x" }),
    mk("chat", "agent", { key: "c:3", unread: 1 }),
  ];
  const folded = layoutOf(xs, { folded: new Set<SectionId>(["chats"]) });
  const f = renderToStaticMarkup(<HeadView entry={entryOf(folded, "head", "chats")} state={st} on={on} />);
  assert.match(f, /data-testid="count-chats"[^>]*>3</);
  assert.match(f, /data-testid="mark-failed"/);
  assert.match(f, /data-testid="mark-mention"/);
  assert.match(f, /folded/);
  const open = renderToStaticMarkup(<HeadView entry={entryOf(layoutOf(xs), "head", "chats")} state={st} on={on} />);
  assert.doesNotMatch(open, /count-chats|mark-/);
  assert.doesNotMatch(open, /folded/);
});

test('"N more" carries the marks of what it hides; "Show less" ends an open list', () => {
  const xs = Array.from({ length: 8 }, (_, n) =>
    mk("chat", "agent", {
      key: `c:${n}`,
      title: `Chat ${n}`,
      lastAt: 100 - n,
      ...(n === 7 ? { failed: "x" } : {}),
      ...(n === 6 ? { mentions: 1 } : {}),
    }),
  );
  const l = layoutOf(xs);
  const html = renderToStaticMarkup(<MoreView entry={entryOf(l, "more", "chats")} state={st} on={on} />);
  assert.match(html, />2 more</);
  assert.match(html, /mark-failed/);
  assert.match(html, /mark-mention/);
  const open = layoutOf(xs, { more: new Set<SectionId>(["chats"]) });
  assert.match(
    renderToStaticMarkup(<LessView entry={entryOf(open, "less", "chats")} state={st} on={on} />),
    />Show less</,
  );
});

test("a failed section says what it could not load and has Retry; the rest of the list is unaffected", () => {
  const l = layoutOf([mk("chat", "agent")], { failed: new Set<SectionId>(["chats"]) });
  const html = renderToStaticMarkup(<ErrorView entry={entryOf(l, "error", "chats")} onRetry={() => {}} />);
  assert.match(html, /Couldn&#x27;t load chats|Couldn't load chats/);
  assert.match(html, /aria-label="Retry loading chats"/);
});

test("a filter that finds nothing says so with Show all; loading draws quiet bars at the real heights", () => {
  const l = layoutOf([mk("chat", "agent")], { filter: "failed" });
  assert.match(
    renderToStaticMarkup(<NoneView entry={entryOf(l, "none")} onShowAll={() => {}} />),
    /Nothing matches[\s\S]*Show all/,
  );
  const sk = layoutOf([], { loading: true });
  const rows = sk.entries.filter((e) => e.type === "skeleton");
  assert.ok(rows.length > 5);
  for (const e of rows)
    assert.match(
      renderToStaticMarkup(<SkeletonView entry={e as Extract<LayoutEntry, { type: "skeleton" }>} />),
      new RegExp(`height:${e.h}px`),
    );
});

test("Tasks has a chevron that folds and a name that opens; folded, the count stays", () => {
  const tasks = [
    mk("task", "task", { verb: { label: "Allow", tone: "accent" } }),
    mk("task", "task", { verb: { label: "Review", tone: "accent" } }),
  ];
  const open = renderToStaticMarkup(
    <TasksRow entry={entryOf(layoutOf(tasks), "tasks")} state={st} on={{ press: () => {}, fold: () => {} }} />,
  );
  assert.match(open, /aria-label="Fold Tasks"/);
  const f = renderToStaticMarkup(
    <TasksRow
      entry={entryOf(layoutOf(tasks, { folded: new Set<SectionId>(["needs"]) }), "tasks")}
      state={st}
      on={{ press: () => {}, fold: () => {} }}
    />,
  );
  assert.match(f, /aria-label="Unfold Tasks"/);
  assert.match(f, /data-folded="true"/);
  assert.match(f, /data-testid="mark-mention"[^>]*>[\s\S]*?>2</);
  assert.match(f, /aria-label="Tasks, 2 need you"/);
});

test("the quiet line of a lived-in Space with no goals", () => {
  const l = layoutOf([mk("chat", "agent")]);
  const html = renderToStaticMarkup(<HintView entry={entryOf(l, "hint")} onPress={() => {}} />);
  assert.match(html, /No goals yet/);
  assert.match(html, /aria-label="New goal"/);
});
