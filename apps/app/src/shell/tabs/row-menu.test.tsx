// The one row menu for rows that only open something (lane r32-nav): Open in New Tab asks for the tab the way Cmd-press does (openIn), so the open rule decides; the menu is the shared open group.
import test from "node:test";
import assert from "node:assert/strict";
import { rowOpenEntries } from "./row-menu.tsx";
import { forgetOpenHow, takeOpenHow } from "./open-how.ts";

test("Open in New Tab runs the row's opener with a tab asked for; Open runs it with nothing asked", () => {
  forgetOpenHow();
  const seen: string[] = [];
  const e = rowOpenEntries({
    label: "Appearance",
    open: () => seen.push(`open:${takeOpenHow()}`),
    openTab: () => seen.push(`tab:${takeOpenHow()}`),
  });
  const run = (label: string): void => {
    const x = e.find((m) => "label" in m && m.label === label);
    assert.ok(x && "onSelect" in x, `${label} is in the menu`);
    x.onSelect?.();
  };
  run("Open");
  run("Open in New Tab");
  assert.deepEqual(seen, ["open:here", "tab:tab"]);
});

test("a row the place cannot show as a tab has no Open in New Tab", () => {
  const e = rowOpenEntries({ label: "Requests", open: () => undefined });
  assert.deepEqual(
    e.map((m) => ("label" in m ? m.label : "-")),
    ["Open"],
  );
});
