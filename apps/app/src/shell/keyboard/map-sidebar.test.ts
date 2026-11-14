// The keys of the new Chats sidebar (design 13 Nov, 2.5 and 2.6) live in the one shell keyboard table, so Settings and the help list them, and none of them displaces another.
import test from "node:test";
import assert from "node:assert/strict";
import { KEYBOARD_MAP, formatCombo, keyboardRows, matchShortcut } from "./map.ts";
import type { KeyLike } from "./map.ts";

const mac = (e: KeyLike) => matchShortcut(e, "mac");

const TABLE: { name: string; e: KeyLike; want: { id: string; arg?: number } | null }[] = [
  {
    name: "Option-Cmd-1 goes to the first place",
    e: { key: "¡", code: "Digit1", metaKey: true, altKey: true },
    want: { id: "place.go", arg: 1 },
  },
  {
    name: "Option-Cmd-5 goes to the fifth place",
    e: { key: "€", code: "Digit5", metaKey: true, altKey: true },
    want: { id: "place.go", arg: 5 },
  },
  { name: "Option-Cmd-6 is no place", e: { key: "6", code: "Digit6", metaKey: true, altKey: true }, want: null },
  { name: "Cmd-N is a new chat", e: { key: "n", metaKey: true }, want: { id: "chat.new" } },
  {
    name: "Shift-Cmd-N is a new group chat",
    e: { key: "N", code: "KeyN", metaKey: true, shiftKey: true },
    want: { id: "chat.newgroup" },
  },
  {
    name: "Option-Cmd-N is a new channel (Option types another letter, the key code decides)",
    e: { key: "˜", code: "KeyN", metaKey: true, altKey: true },
    want: { id: "channel.new" },
  },
  {
    name: "Option-Cmd-G is a new goal",
    e: { key: "©", code: "KeyG", metaKey: true, altKey: true },
    want: { id: "goal.new" },
  },
  {
    name: "Option-Cmd-T is a new task",
    e: { key: "†", code: "KeyT", metaKey: true, altKey: true },
    want: { id: "task.new" },
  },
  {
    name: "Option-Cmd-O is a new note",
    e: { key: "ø", code: "KeyO", metaKey: true, altKey: true },
    want: { id: "note.new" },
  },
  {
    name: "Cmd-Shift-backslash hides the sidebar",
    e: { key: "|", code: "Backslash", metaKey: true, shiftKey: true },
    want: { id: "sidebar.hide" },
  },
  {
    name: "Option-Shift-Down is the next unread chat",
    e: { key: "ArrowDown", altKey: true, shiftKey: true },
    want: { id: "chats.unread.next" },
  },
  {
    name: "Option-Shift-Up is the previous unread chat",
    e: { key: "ArrowUp", altKey: true, shiftKey: true },
    want: { id: "chats.unread.prev" },
  },
];
for (const c of TABLE) test(`sidebar key: ${c.name}`, () => assert.deepEqual(mac(c.e), c.want));

test("what the shell keys did before still does it", () => {
  assert.deepEqual(mac({ key: "t", metaKey: true }), { id: "tab.new" });
  assert.deepEqual(mac({ key: "4", metaKey: true }), { id: "agent.jump", arg: 4 });
  assert.deepEqual(mac({ key: "!", code: "Digit1", metaKey: true, shiftKey: true }), { id: "space.switch", arg: 1 });
  assert.deepEqual(mac({ key: "ArrowDown", altKey: true }), { id: "unread.next" });
  assert.deepEqual(mac({ key: "d", metaKey: true }), { id: "star.toggle" });
  assert.deepEqual(mac({ key: "k", metaKey: true, shiftKey: true }), { id: "softphone.open" });
});

test("every shell combo in the table is matched to its own id, and none matches two", () => {
  const seen = new Map<string, string>();
  for (const s of KEYBOARD_MAP) {
    if (s.local) continue;
    const parts = s.combo.split("-");
    const e: KeyLike = {
      key:
        parts[parts.length - 1]!.length === 1
          ? parts[parts.length - 1]!.toLowerCase()
          : `Arrow${parts[parts.length - 1]}`,
      metaKey: parts.includes("Cmd"),
      altKey: parts.includes("Alt"),
      shiftKey: parts.includes("Shift"),
    };
    const code = parts[parts.length - 1]!;
    if (/^\d$/.test(code)) e.code = `Digit${code}`;
    else if (/^[A-Z]$/i.test(code)) e.code = `Key${code.toUpperCase()}`;
    else if (code === "\\") e.code = "Backslash";
    const m = matchShortcut(e, "mac");
    assert.equal(m?.id, s.id, `${s.combo} should be ${s.id}`);
    assert.ok(!seen.has(s.combo), `${s.combo} is in the table twice`);
    seen.set(s.combo, s.id);
  }
});

test("the table prints them for Settings and the help, on each platform", () => {
  assert.equal(formatCombo("Alt-Cmd-N", "mac"), "⌥⌘N");
  assert.equal(formatCombo("Shift-Cmd-N", "mac"), "⇧⌘N");
  assert.equal(formatCombo("Cmd-Shift-\\", "other"), "Ctrl+Shift+\\");
  const rows = keyboardRows("mac");
  assert.equal(rows.find((r) => r.id === "place.go")?.keys, "⌥⌘1…5");
  assert.equal(rows.find((r) => r.id === "chats.unread.next")?.keys, "⌥⇧↓");
  for (const id of [
    "chat.new",
    "chat.newgroup",
    "channel.new",
    "goal.new",
    "task.new",
    "note.new",
    "sidebar.hide",
    "row.pin",
    "row.read",
    "row.mute",
    "row.archive",
    "row.rename",
    "row.link",
    "list.filter",
  ])
    assert.ok(
      rows.some((r) => r.id === id),
      `${id} is listed`,
    );
});

test("no combo is shared by a shell key and a place key that could meet it (Cmd-N is the one chat key; Cmd-T is still New tab)", () => {
  const shell = KEYBOARD_MAP.filter((s) => !s.local).map((s) => s.combo);
  assert.equal(new Set(shell).size, shell.length);
});
