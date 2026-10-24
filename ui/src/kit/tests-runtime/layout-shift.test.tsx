// Navigate and layout shift: across a 20-screen run every screen occupies the same box whether it is loading, empty,
// offline, in error or ready, so the swap between states moves nothing. The browser measurement (layout-shift sum over the
// same run in headless Chrome) is the shots probe on scripts/shots/mounts/P-L9_13.tsx.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { KitScreen } from "../runtime/KitScreen.tsx";
import { KitSlot, screensFor } from "../runtime/KitSlot.tsx";
import { createScreenRegistry } from "../runtime/registry.ts";
import { previewDef } from "../runtime/preview.ts";
import { screens } from "../../../../generated/screens.ts";
import { fakeEnv, listDef, people } from "./fakes.tsx";
import type { KitScreenDef } from "../types.ts";

/** The class list of the screen root: React Native Web turns a style into atomic classes, so equal classes mean equal box. */
const rootClass = (html: string) => {
  const tag = /<div[^>]*data-testid="kit-screen-[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
  return /class="([^"]*)"/.exec(tag)?.[1] ?? "";
};

test("20 screens: the root box is identical in loading, empty, offline, error and ready", () => {
  const run = screens.slice(0, 20).map(previewDef);
  assert.equal(run.length, 20);
  for (const def of run) {
    const first = Object.keys(def.queries)[0];
    const remote: KitScreenDef = first ? { ...def, queries: { ...def.queries, [first]: { ...def.queries[first]!, live: false } } } : def;
    const html = {
      loading: renderToStaticMarkup(<KitScreen def={def} env={fakeEnv({ loading: first ? [first] : [] })} />),
      ready: renderToStaticMarkup(<KitScreen def={def} env={fakeEnv({ data: first ? { [first]: people } : {} })} />),
      empty: renderToStaticMarkup(<KitScreen def={def} env={fakeEnv({ data: first ? { [first]: [] } : {} })} />),
      offline: renderToStaticMarkup(<KitScreen def={remote} env={fakeEnv({ online: false, fetch: () => new Promise(() => {}) })} />),
      error: renderToStaticMarkup(<KitScreen def={def} env={fakeEnv({ hooks: { query: () => { throw new Error("x"); } } })} />),
    };
    const base = rootClass(html.ready);
    assert.ok(base.length > 0, `${def.id} has a root class`);
    for (const [state, markup] of Object.entries(html)) {
      if (!first && state !== "ready") continue;
      assert.equal(rootClass(markup), base, `${def.id} ${state}`);
    }
  }
});

test("a slot shows screens by place and slot, hides those the viewer cannot use, and shows one at a time in a single slot", () => {
  const mk = (id: string, slot: KitScreenDef["slot"], needs?: string[]): KitScreenDef => ({
    id, place: "records", slot, queries: {}, actions: {}, states: listDef.states, layout: { t: "text", value: `screen ${id}` }, ...(needs ? { needs } : {}),
  });
  const registry = createScreenRegistry([mk("a.one", "main"), mk("a.two", "main"), mk("a.admin", "main", ["admin.view"]), mk("s.one", "side"), mk("s.two", "side")]);
  const can = (p: string) => p !== "admin.view";
  assert.deepEqual(screensFor(registry, "records", "main", can).map((d) => d.id), ["a.one", "a.two"]);
  const env = fakeEnv({ can });
  const main = renderToStaticMarkup(<KitSlot place="records" slot="main" registry={registry} env={env} />);
  assert.ok(main.includes("screen a.one") && !main.includes("screen a.two") && !main.includes("screen a.admin"));
  const second = renderToStaticMarkup(<KitSlot place="records" slot="main" registry={registry} env={env} activeId="a.two" />);
  assert.ok(second.includes("screen a.two") && !second.includes("screen a.one"));
  const side = renderToStaticMarkup(<KitSlot place="records" slot="side" registry={registry} env={env} />);
  assert.ok(side.includes("screen s.one") && side.includes("screen s.two"));
});
