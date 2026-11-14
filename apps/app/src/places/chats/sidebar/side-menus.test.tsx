// The menus of the new sidebar: one per kind of entry, the same items the keys reach, the word Pin, danger last, nothing offered that cannot be done.
import test from "node:test";
import assert from "node:assert/strict";
import { iconsAllOrNone } from "../../../../../../ui/src/Menu/index.tsx";
import { isHead, isItem, isSeparator } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/props.ts";
import { shortcutFor } from "../../../../../../ui/src/Menu/keys.ts";
import { FILTER_CHOICES, filterChoices } from "./layout.ts";
import type { Item, ItemKind } from "./layout.ts";
import { filterMenu, headMenu, newMenu, notesMenu, rowMenu, tasksMenu } from "./side-menus.ts";
import type { RowDo } from "./side-menus.ts";

const item = (kind: ItemKind, o: Partial<Item> = {}): Item => ({
  key: `${kind}:1`,
  kind,
  shape: "agent",
  title: "Thing",
  faces: [],
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
const labels = (m: readonly MenuEntry[]): string[] => m.filter(isItem).map((e) => e.label);
const hints = (m: readonly MenuEntry[]): Record<string, string | undefined> =>
  Object.fromEntries(m.filter(isItem).map((e) => [e.label, e.hint]));
const ran: string[] = [];
const ALL: Required<RowDo> = Object.fromEntries(
  [
    "open",
    "openTab",
    "markRead",
    "markUnread",
    "pin",
    "unpin",
    "mute",
    "unmute",
    "rename",
    "addPeople",
    "invite",
    "copyLink",
    "copyHandle",
    "viewProfile",
    "archive",
    "unarchive",
    "deleteChat",
    "leave",
    "pause",
    "editInstructions",
    "deleteAgent",
    "reportProgress",
    "markStuck",
    "pauseGoal",
  ].map((k) => [k, () => void ran.push(k)]),
) as Required<RowDo>;

const KINDS: { kind: ItemKind; o?: Partial<Item>; want: string[] }[] = [
  {
    kind: "chat",
    want: [
      "Open",
      "Open in a new tab",
      "Mark as unread",
      "Pin",
      "Mute",
      "Rename",
      "Add people…",
      "Copy link",
      "Archive",
      "Delete chat",
    ],
  },
  {
    kind: "chat",
    o: { withPeople: true, unread: 2, muted: true, archived: true },
    want: [
      "Open",
      "Open in a new tab",
      "Mark as read",
      "Pin",
      "Unmute",
      "Rename",
      "Add people…",
      "Copy link",
      "Unarchive",
      "Leave chat",
    ],
  },
  {
    kind: "person",
    o: { threadId: "t" },
    want: [
      "Message",
      "Open in a new tab",
      "Mark as unread",
      "Pin",
      "Mute",
      "View profile",
      "Add to a chat…",
      "Copy @handle",
    ],
  },
  {
    kind: "person",
    want: ["Message", "Open in a new tab", "Pin", "Mute", "View profile", "Add to a chat…", "Copy @handle"],
  },
  {
    kind: "channel",
    want: [
      "Open",
      "Open in a new tab",
      "Mark as unread",
      "Pin",
      "Mute",
      "Invite people…",
      "Copy link",
      "Leave channel",
    ],
  },
  { kind: "project", want: ["Open project", "Open in a new tab", "Mark as unread", "Pin", "Mute", "Copy link"] },
  {
    kind: "agent",
    want: [
      "Message",
      "Open in a new tab",
      "Pin",
      "Mute",
      "View profile",
      "Add to a chat…",
      "Pause",
      "Edit instructions…",
      "Delete agent",
    ],
  },
  {
    kind: "agent",
    o: { assistant: true },
    want: ["Message", "Open in a new tab", "Pin", "Mute", "View profile", "Add to a chat…"],
  },
  {
    kind: "goal",
    want: ["Open", "Open in a new tab", "Pin", "Report progress…", "Mark stuck…", "Pause", "Copy link"],
  },
  { kind: "task", want: ["Open", "Open in a new tab", "Copy link"] },
];
KINDS.forEach((c, n) =>
  test(`menu ${n}: ${c.kind}${c.o ? ` ${JSON.stringify(c.o)}` : ""}`, () => {
    const m = rowMenu(item(c.kind, c.o), false, ALL, { manageAgent: true });
    assert.deepEqual(labels(m), c.want);
    assert.ok(iconsAllOrNone(m), "all icons or none");
    const last = m[m.length - 1]!;
    assert.ok(!isSeparator(last) && !isHead(last), "no stray separator at the end");
    // danger sits last and alone in its group
    const danger = m.filter(isItem).filter((e) => e.danger);
    if (danger.length > 0) assert.equal((last as MenuItem).danger, true);
    assert.ok(!labels(m).some((l) => /star/i.test(l)), "the word is Pin, never Star");
  }),
);

test("every kind of row has a menu (the 8 of 16 entries that had none now do)", () => {
  const kinds: ItemKind[] = ["chat", "channel", "project", "goal", "person", "agent", "task"];
  for (const k of kinds) assert.ok(rowMenu(item(k), false, ALL).length > 0, k);
});

test("Pin says what it will do: Unpin on a pinned row", () => {
  assert.ok(labels(rowMenu(item("chat"), true, ALL)).includes("Unpin"));
  assert.ok(!labels(rowMenu(item("chat"), true, ALL)).includes("Pin"));
});

test("an item the sidebar cannot do is not in the menu; a person who cannot manage agents never sees Delete agent", () => {
  const m = rowMenu(item("chat"), false, { open: ALL.open, pin: ALL.pin });
  assert.deepEqual(labels(m), ["Open", "Pin"]);
  const a = rowMenu(item("agent"), false, ALL, {});
  assert.ok(!labels(a).includes("Delete agent"));
  assert.ok(labels(rowMenu(item("agent"), false, ALL, { manageAgent: true })).includes("Delete agent"));
});

test("a chat of me and agents is deleted; a chat with people is left", () => {
  assert.ok(labels(rowMenu(item("chat"), false, ALL)).includes("Delete chat"));
  assert.ok(!labels(rowMenu(item("chat", { withPeople: true }), false, ALL)).includes("Delete chat"));
  assert.ok(labels(rowMenu(item("chat", { withPeople: true }), false, ALL)).includes("Leave chat"));
});

test("the hint column is the key the focused row runs: Enter, tab, U, P, M, F2, E, Cmd-Backspace, Cmd-I", () => {
  const h = hints(rowMenu(item("chat"), false, ALL));
  assert.deepEqual(h, {
    Open: "Enter",
    "Open in a new tab": "⌘↵",
    "Mark as unread": "U",
    Pin: "P",
    Mute: "M",
    Rename: "F2",
    "Add people…": undefined,
    "Copy link": "⇧⌘C",
    Archive: "E",
    "Delete chat": "⌘⌫",
  });
  assert.equal(hints(rowMenu(item("person"), false, ALL))["View profile"], "⌘I");
});

test("the letter keys run the menu's item on the focused row (the shared key map of ui/Menu)", () => {
  ran.length = 0;
  const m = rowMenu(item("chat"), false, ALL);
  for (const key of ["p", "u", "m", "e", "F2"]) shortcutFor(m, { key })!.onSelect!();
  shortcutFor(m, { key: "Enter", metaKey: true })!.onSelect!();
  shortcutFor(m, { key: "Backspace", metaKey: true })!.onSelect!();
  assert.deepEqual(ran, ["pin", "markUnread", "mute", "archive", "rename", "openTab", "deleteChat"]);
});

// ---------------------------------------------------------------- fixed rows, heads, "N more"

test("Tasks: Open, a new tab, New task", () => {
  const m = tasksMenu({ open: () => {}, openTab: () => {}, newTask: () => {} }, () => "⌥⌘T");
  assert.deepEqual(labels(m), ["Open", "Open in a new tab", "New task"]);
  assert.equal(hints(m)["New task"], "⌥⌘T");
});

test("Notes & artifacts: Open, each tab by name, a new tab, New note", () => {
  const f = () => {};
  const m = notesMenu({ open: f, openNotes: f, openArtifacts: f, openTab: f, newNote: f });
  assert.deepEqual(labels(m), ["Open", "Open Notes", "Open Artifacts", "Open in a new tab", "New note"]);
});

const HEAD_TABLE: { section: "pinned" | "chats" | "channels" | "team" | "goals"; folded: boolean; want: string[] }[] = [
  { section: "chats", folded: false, want: ["Fold", "Mark all as read", "New chat"] },
  { section: "chats", folded: true, want: ["Unfold", "Mark all as read", "New chat"] },
  { section: "channels", folded: false, want: ["Fold", "New channel…", "Browse channels…"] },
  { section: "team", folded: false, want: ["Fold", "Invite someone…", "New agent…"] },
  { section: "pinned", folded: false, want: ["Fold", "Unpin all"] },
  { section: "goals", folded: false, want: ["Fold", "New goal\u2026"] },
];
for (const c of HEAD_TABLE)
  test(`head menu: ${c.section}${c.folded ? " folded" : ""}`, () => {
    const f = () => {};
    const m = headMenu(c.section, c.folded, {
      fold: f,
      unfold: f,
      markAllRead: f,
      newChat: f,
      newChannel: f,
      browseChannels: f,
      invite: f,
      newAgent: f,
      unpinAll: f,
      newGoal: f,
    });
    assert.deepEqual(labels(m), c.want);
  });

// ---------------------------------------------------------------- "+" and Filter

test('the "+" menu has all six things, an icon on each, and the key of each from the one table', () => {
  const f = () => {};
  const m = newMenu({ newChat: f, newGroup: f, newChannel: f, newGoal: f, newTask: f, newNote: f }, (id) => `[${id}]`);
  assert.deepEqual(labels(m), ["New chat", "New group chat", "New channel", "New goal", "New task", "New note"]);
  assert.ok(m.filter(isItem).every((e) => typeof e.icon === "string" && e.icon.startsWith("<svg")));
  assert.deepEqual(
    m.filter(isItem).map((e) => e.hint),
    ["[chat.new]", "[chat.newgroup]", "[channel.new]", "[goal.new]", "[task.new]", "[note.new]"],
  );
});

test('the "+" menu leaves out what this person cannot make (a guest has no channels)', () => {
  const f = () => {};
  assert.deepEqual(labels(newMenu({ newChat: f, newNote: f })), ["New chat", "New note"]);
});

test("the filter menu: Show, Only, a tick on the one set, counts in the quiet column, then Next unread", () => {
  const items = [item("chat", { unread: 1 }), item("chat", { unread: 2 }), item("goal")];
  const picked: string[] = [];
  const m = filterMenu(
    filterChoices(items),
    "unread",
    { pick: (f) => picked.push(f), nextUnread: () => {} },
    () => "⌥⇧↓",
  );
  assert.deepEqual(
    m.filter(isHead).map((e) => e.head),
    ["Show", "Only"],
  );
  assert.deepEqual(labels(m), [...FILTER_CHOICES.map((c) => c.label), "Next unread"]);
  const unread = m.filter(isItem).find((e) => e.label === "Unread")!;
  assert.equal(unread.checked, true);
  assert.equal(unread.count, 2);
  assert.equal(m.filter(isItem).find((e) => e.label === "Everything")!.count, undefined, "Everything has no count");
  assert.equal(m.filter(isItem).filter((e) => e.checked).length, 1);
  m.filter(isItem).find((e) => e.label === "Mentions")!.onSelect!();
  assert.deepEqual(picked, ["mentions"]);
  assert.equal(hints(m)["Next unread"], "⌥⇧↓");
});
