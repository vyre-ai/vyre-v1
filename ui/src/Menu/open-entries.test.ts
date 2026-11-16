// The "open" group every row menu starts with (lane r32-nav): the words, order and key are the same in every place, and a way a place cannot offer is left out.
import test from "node:test";
import assert from "node:assert/strict";
import { openEntries } from "./open-entries.ts";

const labels = (e: ReturnType<typeof openEntries>): string[] => e.map((x) => ("label" in x ? x.label : "-"));

test("Open, Open in New Tab and Open in Side Pane, in that order, each only when the place offers it", () => {
  const f = (): void => undefined;
  assert.deepEqual(labels(openEntries({ open: f, openTab: f, openPane: f })), [
    "Open",
    "Open in New Tab",
    "Open in Side Pane",
  ]);
  assert.deepEqual(labels(openEntries({ open: f, openTab: f })), ["Open", "Open in New Tab"]);
  assert.deepEqual(labels(openEntries({ open: f })), ["Open"]);
});

test("each item runs its own function, and Open in New Tab carries the shared key", () => {
  const ran: string[] = [];
  const e = openEntries({
    open: () => ran.push("open"),
    openTab: () => ran.push("tab"),
    openPane: () => ran.push("pane"),
  });
  for (const x of e) if ("onSelect" in x) x.onSelect?.();
  assert.deepEqual(ran, ["open", "tab", "pane"]);
  const tab = e[1]! as { hint?: string };
  assert.equal(tab.hint, "⌘↵");
});

test("a row that does not answer Cmd+Enter shows no key for Open in New Tab", () => {
  const e = openEntries({ open: () => undefined, openTab: () => undefined, tabKey: false });
  assert.equal((e[1]! as { hint?: string }).hint, undefined);
});
