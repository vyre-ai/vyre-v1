// The speed half of space-switch.test.ts (split out so that only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// @tsx
// Space switch (spec 2.1, ARCH 7.0, b15): mounts the three seeds (Northwind, Personal, Harbor Studio), opens every place in Northwind, switches, and asserts that every query
// key and subscription carries the new spaceId, that no Northwind id appears in the DOM at any frame after the first skeleton frame, that the Kit, skin, rail, title and
// notification set changed, and that tabs restore when switching back. Perf: space_switch under 500 ms with the skeleton.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createThemeController, seedSpaceSkin } from "../../../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../../../ui/src/theme/index.ts";
import { railPlaces } from "../rail/kits.ts";
import { Shell } from "./Shell.tsx";
import { SpaceSkeleton } from "./Skeleton.tsx";
import { SPACE_SWITCH_BUDGET_MS, titleText } from "./hub.ts";
import type { HubOptions, ShellHub } from "./hub.ts";
import { shellKey } from "./keys.ts";
import { SAMPLE_ROWS, createSampleShell, samplePlace } from "./sample.tsx";

function rig(openId = "nw", extra: Partial<Omit<HubOptions, "spaces">> = {}) {
  const attrs: Record<string, string> = {};
  const root: ThemeRoot = {
    setAttribute: (n, v) => { attrs[n] = v; },
    setProperty: () => undefined,
    removeProperty: () => undefined,
  };
  const theme = createThemeController({ personId: "irfad", spaceId: openId, spaceSkin: seedSpaceSkin(), prefersDark: false, root, storage: null });
  const hub = createSampleShell({ openId, theme, skeletonMs: 0, ...extra });
  return { hub, theme, attrs };
}

const html = (hub: ShellHub): string => renderToStaticMarkup(createElement(Shell, { hub, renderPlace: samplePlace })).replaceAll("<!-- -->", "");
const text = (markup: string): string => markup.replace(/<[^>]*>/g, "");

test("perf space_switch: under 500 ms with the skeleton, pre-opened and cold", async () => {
  const { hub } = rig("nw", { openReplica: () => new Promise<void>((resolve) => { setTimeout(resolve, 25); }), skeletonMs: 120 });
  const ran: string[] = [];
  for (const to of ["hb", "me", "nw"]) {
    hub.switchTo(to);
    assert.equal(hub.state().phase, "skeleton");
    await hub.whenReady();
    html(hub);
    hub.placeDrawn(hub.state().epoch);
    ran.push(to);
  }
  const probes = hub.probes();
  assert.equal(probes.length, 3);
  for (const p of probes) {
    console.log(`perf space_switch ${p.from}->${p.to} ${p.ms.toFixed(1)} ms (budget ${SPACE_SWITCH_BUDGET_MS} ms)`);
    assert.ok(p.ms < SPACE_SWITCH_BUDGET_MS, `${p.from}->${p.to} took ${p.ms} ms`);
  }
  assert.deepEqual(ran, ["hb", "me", "nw"]);
});
