// Home draws one "All clear" card when Needs you, Away, Routines, Today and Starred are all empty, keeps My work as its own section, and shows every section that has items.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, textOf } from "../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import Home from "./index.tsx";
import { homeBSlots } from "./sections-b/index.ts";
import { createSampleHomeB } from "./sections-b/sample.ts";
import { Composer } from "../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../ui/src/Composer/Deferred.tsx";
import { publishProgress } from "../../onboarding/store.ts";
import { allClearNow, setSectionKind } from "./sections-a/allclear.ts";

installComposerForTests(Composer);

async function draw(variant: "northwind" | "firstrun") {
  const h = createSampleHomeB(variant, { aiConnected: variant === "northwind" });
  const { top, bottom } = homeBSlots(h.extras);
  const r = createRoot();
  await act(async () => { r.render(<Home data={h.data} top={top} bottom={bottom} personal={false} />); });
  await flush(); await flush();
  return { root: r.container as unknown as Node, stop: async () => { await act(async () => { r.unmount(); }); } };
}

test("a Space with nothing in any section shows one All clear card, keeps My work, and hides the five empty sections", async () => {
  const restore = installDom();
  publishProgress(null);
  const p = await draw("firstrun");
  try {
    assert.ok(find(p.root, "s-allclear"), "the card");
    assert.match(textOf(find(p.root, "s-allclear")), /All clear/);
    for (const id of ["s-needs", "s-away", "s-routines", "s-today", "s-starred"]) assert.equal(find(p.root, id), null, `${id} steps aside`);
    assert.ok(find(p.root, "s-work"), "My work stays");
    assert.ok(find(p.root, "work-new"), "with its New task");
    assert.ok(!/0 · 0 due/.test(textOf(find(p.root, "work-head"))), "no zero counts");
  } finally { await p.stop(); restore(); }
});

test("a Space with items shows its sections and no All clear card", async () => {
  const restore = installDom();
  publishProgress(null);
  const p = await draw("northwind");
  try {
    assert.equal(find(p.root, "s-allclear"), null);
    for (const id of ["s-needs", "s-work", "s-today"]) assert.ok(find(p.root, id), id);
  } finally { await p.stop(); restore(); }
});

test("the card needs the three sections every Home has, and one section with items cancels it", () => {
  for (const id of ["needs", "away", "routines", "today", "starred"]) setSectionKind(id, null);
  assert.equal(allClearNow(), false, "nothing registered is not all clear");
  setSectionKind("needs", "empty"); setSectionKind("away", "empty");
  assert.equal(allClearNow(), false, "Routines has not reported");
  setSectionKind("routines", "empty");
  assert.equal(allClearNow(), true);
  setSectionKind("today", "items");
  assert.equal(allClearNow(), false, "a section with items shows normally");
  setSectionKind("today", "loading");
  assert.equal(allClearNow(), false, "while one still loads, no card yet");
  for (const id of ["needs", "away", "routines", "today"]) setSectionKind(id, null);
});
