// A menu that asks before something destructive ("Delete Ember?" with Delete and Cancel): the destructive item is never first under the pointer, and the safe item is the one lit when it opens (owner rule, 19 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { askLit, askOrder, isAsk } from "./entries.ts";
import { isItem } from "./props.ts";
import type { MenuEntry } from "./props.ts";

const del = { label: "Delete agent", danger: true, onSelect: () => undefined };
const cancel = { label: "Cancel" };

test("the shape of the callers (a head with a question, Delete, Cancel) is an ask; Delete moves after Cancel and Cancel opens lit", () => {
  const entries: MenuEntry[] = [{ head: "Delete Ember? Its chats stay; its work and memory go." }, del, cancel];
  assert.ok(isAsk(entries));
  const ordered = askOrder(entries);
  assert.deepEqual(
    ordered.map((e) => ("head" in e ? "head" : (e as { label: string }).label)),
    ["head", "Cancel", "Delete agent"],
  );
  assert.equal(askLit(ordered), 1, "Cancel is the lit row");
  assert.ok(isItem(ordered[1]!) && (ordered[1] as { danger?: boolean }).danger !== true);
});

test("any other menu is left alone: no head, a head that is not a question, or no danger item", () => {
  const plain: MenuEntry[] = [{ label: "Open" }, del];
  assert.equal(askOrder(plain), plain);
  assert.equal(askLit(plain), -1);
  const sect: MenuEntry[] = [{ head: "Agents" }, del, cancel];
  assert.equal(askOrder(sect), sect, "a section head is not a question");
  const calm: MenuEntry[] = [{ head: "Switch back?" }, { label: "Switch" }, cancel];
  assert.equal(askOrder(calm), calm, "no danger item: not a destructive ask");
});

test("a disabled safe item is not lit; two danger items both stay after the safe ones; the question stays first", () => {
  const entries: MenuEntry[] = [
    { head: "Remove both?" },
    del,
    { label: "Remove all", danger: true },
    { label: "Keep", disabled: true },
    cancel,
  ];
  const ordered = askOrder(entries);
  assert.deepEqual(
    ordered.map((e) => ("head" in e ? "head" : (e as { label: string }).label)),
    ["head", "Keep", "Cancel", "Delete agent", "Remove all"],
  );
  assert.equal(askLit(ordered), 2, "Cancel, not the disabled Keep");
});

test("a menu with groups is an ordinary menu even when its head asks something; its separators stay", () => {
  const grouped: MenuEntry[] = [{ head: "What next?" }, { label: "Open" }, { separator: true }, del];
  assert.equal(askOrder(grouped), grouped);
  assert.equal(askLit(grouped), -1);
  const long: MenuEntry[] = [{ head: "Pick?" }, ...Array.from({ length: 7 }, (_, i) => ({ label: `Item ${i}` })), del];
  assert.equal(isAsk(long), false, "an ask is short");
});
