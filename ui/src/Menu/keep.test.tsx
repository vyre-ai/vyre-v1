// ui/Menu rows that stay: a row marked keep runs and leaves the menu open (a filter row ticked, a label made), `update` swaps the rows of the open menu in place, a hint sits in the
// right column, and a menu with a search tells its surface what was typed.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { installDom, find, flush, mount, press, textOf, typeInto } from "../testing/dom.ts";
import { useMenu } from "./index.tsx";
import type { MenuEntry } from "./index.tsx";

type Api = ReturnType<typeof useMenu>;
let api: Api | null = null;
function Host(): ReactElement | null {
  const m = useMenu();
  api = m;
  return m.element;
}

test("a kept row runs and the menu stays; update draws the new rows in place; a plain row closes it", async () => {
  installDom();
  const root = await mount(createRoot, <Host />);
  const ran: string[] = [];
  const rows = (on: boolean): MenuEntry[] => [
    { label: "Lab 8", keep: true, checked: on, count: 3, onSelect: () => ran.push("tick") },
    { label: "Clear the filter", hint: "Esc", onSelect: () => ran.push("clear") },
  ];
  await act(async () => { api!.show(rows(false), 10, 10, "other"); });
  await flush();
  assert.ok(find(root, "menu"));
  assert.match(textOf(find(root, "menu-hint-Clear the filter")), /Esc/, "the hint sits in its own column");
  await press(find(root, "menu-item-Lab 8"));
  assert.deepEqual(ran, ["tick"]);
  assert.ok(find(root, "menu"), "a kept row leaves the menu open");
  await act(async () => { api!.update(rows(true)); });
  assert.equal(find(root, "menu-item-Lab 8")?.props["aria-checked"], true, "the open menu shows the new rows");
  await press(find(root, "menu-item-Clear the filter"));
  await flush();
  assert.deepEqual(ran, ["tick", "clear"]);
  assert.equal(find(root, "menu"), null, "a plain row closes the menu");
  await act(async () => { api!.update(rows(false)); });
  assert.equal(find(root, "menu"), null, "update with no menu open opens nothing");
});

test("a menu with a search tells its surface what was typed", async () => {
  installDom();
  const root = await mount(createRoot, <Host />);
  const typed: string[] = [];
  await act(async () => { api!.show([{ label: "Lab 8", keep: true }], 10, 10, "other", undefined, { search: "Find or make a label", onSearch: (q) => typed.push(q) }); });
  await flush();
  await typeInto(find(root, "menu-search"), "Partners");
  assert.deepEqual(typed, ["Partners"]);
});
