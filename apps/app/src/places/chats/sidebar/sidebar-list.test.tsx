// The list: every entry of a lived-in and a busy Space has a defined press and a menu (or says why not), and the rows draw at their fixed heights.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildLayout } from "./layout.ts";
import type { Item, ItemKind, LayoutEntry, SectionId, Shape } from "./layout.ts";
import { SidebarList, entryMenu } from "./SidebarList.tsx";
import type { SidebarListProps } from "./SidebarList.tsx";
import { ENTRY_KINDS_WITHOUT_MENU, ENTRY_KINDS_WITH_MENU } from "./side-menus.ts";

let n = 0;
const mk = (kind: ItemKind, shape: Shape, o: Partial<Item> = {}): Item => ({
  key: `${kind}:${++n}`,
  kind,
  shape,
  title: `${kind} ${n}`,
  faces: [{ id: "agt_1", name: "Ember" }],
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
});
const f = () => {};
const props = (layout: SidebarListProps["layout"], calls: string[] = []): SidebarListProps => ({
  layout,
  selected: null,
  rowDo: () => ({
    open: f,
    openTab: f,
    pin: f,
    unpin: f,
    mute: f,
    markRead: f,
    copyLink: f,
    rename: f,
    archive: f,
    deleteChat: f,
  }),
  headDo: () => ({
    fold: f,
    unfold: f,
    markAllRead: f,
    newChat: f,
    newChannel: f,
    browseChannels: f,
    invite: f,
    newAgent: f,
    unpinAll: f,
  }),
  tasksDo: { open: f, openTab: f, newTask: f },
  open: (x, how) => void calls.push(`open:${how}:${x.key}`),
  openTasks: () => void calls.push("tasks"),
  fold: (s) => void calls.push(`fold:${s}`),
  toggleMore: (s) => void calls.push(`more:${s}`),
  retry: (s) => void calls.push(`retry:${s}`),
  showAll: f,
  openPinned: f,
  nextUnread: f,
  openFilter: f,
  copyLink: f,
  search: f,
  leave: f,
});

const lived = (): Item[] => [
  mk("task", "task", { verb: { label: "Allow", tone: "accent" }, sub: "Docs is holding the send" }),
  mk("chat", "agent", { working: true, sub: "Editing upload.ts" }),
  mk("goal", "goal", { progress: { done: 3, total: 7 } }),
  mk("person", "person", { mentions: 2 }),
  mk("chat", "assistant", { faces: [{ id: "assistant", name: "Assistant" }] }),
  mk("chat", "group", { unread: 1 }),
  mk("chat", "agent", { failed: "Stopped" }),
  mk("channel", "channel", { muted: true }),
  mk("project", "project"),
  mk("person", "person"),
  mk("agent", "agent"),
];

test("every entry of a lived-in Space is a typed entry that is pressed, and every kind but four has a menu", () => {
  const items = lived();
  const l = buildLayout({
    items,
    pins: [items[3]!.key],
    filter: "all",
    folded: new Set<SectionId>(),
    more: new Set<SectionId>(),
    open: null,
    failed: new Set<SectionId>(["channels"]),
  });
  const p = props(l);
  const pinned = new Set(l.entries.filter((e) => e.type === "row" && e.section === "pinned").map((e) => e.key));
  const seen = new Set<string>();
  for (const e of l.entries) {
    const m = entryMenu(e, p, pinned);
    const kind = e.type === "row" ? e.item.kind : e.type;
    seen.add(kind);
    if ((ENTRY_KINDS_WITHOUT_MENU as readonly string[]).includes(e.type))
      assert.equal(m, null, `${e.type} has no menu`);
    else assert.ok(m && m.length > 0, `${kind} has a menu`);
  }
  for (const k of ["task", "chat", "goal", "channel", "project", "person", "agent", "tasks", "head"])
    assert.ok(seen.has(k), `${k} drawn`);
  assert.ok((ENTRY_KINDS_WITH_MENU as readonly string[]).includes("more"));
});

test('"N more", "Show less" and a head share the head menu; Tasks has its own', () => {
  const items = Array.from({ length: 9 }, () => mk("chat", "agent"));
  const l = buildLayout({
    items,
    pins: [],
    filter: "all",
    folded: new Set<SectionId>(),
    more: new Set<SectionId>(),
    open: null,
  });
  const p = props(l);
  const labels = (e: LayoutEntry) => (entryMenu(e, p, new Set()) ?? []).flatMap((m) => ("label" in m ? [m.label] : []));
  const head = l.entries.find((e) => e.type === "head" && e.section === "chats")!;
  const more = l.entries.find((e) => e.type === "more")!;
  assert.deepEqual(labels(more), labels(head));
  assert.deepEqual(labels(l.entries.find((e) => e.type === "tasks")!), [
    "Open",
    "Open in a new tab",
    "Fold",
    "New task",
  ]);
});

test("a pinned row's menu says Unpin; the same row elsewhere says Pin", () => {
  const x = mk("chat", "agent");
  const l = buildLayout({
    items: [x],
    pins: [x.key],
    filter: "all",
    folded: new Set<SectionId>(),
    more: new Set<SectionId>(),
    open: null,
  });
  const row = l.entries.find((e) => e.type === "row")!;
  const lab = (pinned: boolean) =>
    (entryMenu(row, props(l), new Set(pinned ? [row.key] : [])) ?? []).flatMap((m) => ("label" in m ? [m.label] : []));
  assert.ok(lab(true).includes("Unpin") && !lab(true).includes("Pin"));
  assert.ok(lab(false).includes("Pin"));
});

test("the list draws every kind of entry at its fixed height inside one window", () => {
  const items = lived();
  const l = buildLayout({
    items,
    pins: [items[3]!.key],
    filter: "all",
    folded: new Set<SectionId>(),
    more: new Set<SectionId>(),
    open: null,
    failed: new Set<SectionId>(["channels"]),
  });
  const html = renderToStaticMarkup(<SidebarList {...props(l)} window={{ start: 0, end: l.entries.length }} />);
  assert.match(html, /data-testid="sidebar-list"/);
  assert.match(html, /role="listbox"/);
  for (const t of [
    "goal-ring",
    "face-stack",
    "mark-failed",
    "mark-muted",
    "mark-mention",
    "row-verb",
    "section-error-channels",
    "head-chats",
  ])
    assert.match(html, new RegExp(`data-testid="${t}"`), t);
  for (const h of new Set(l.entries.map((e) => e.h))) assert.match(html, new RegExp(`height:${h}px`), `a ${h}px entry`);
});

test("a busy Space (60 chats, 40 channels, 25 agents) draws a few dozen entries, not hundreds", () => {
  const items = [
    ...Array.from({ length: 60 }, () => mk("chat", "agent")),
    ...Array.from({ length: 40 }, () => mk("channel", "channel")),
    ...Array.from({ length: 25 }, () => mk("agent", "agent")),
  ];
  const l = buildLayout({
    items,
    pins: [],
    filter: "all",
    folded: new Set<SectionId>(),
    more: new Set<SectionId>(),
    open: null,
  });
  const html = renderToStaticMarkup(<SidebarList {...props(l)} window={{ start: 0, end: l.entries.length }} />);
  assert.ok(l.entries.length < 30, `${l.entries.length} entries`);
  assert.ok((html.match(/data-testid="row-[a-z]+:\d+"/g) ?? []).length < 25);
});
