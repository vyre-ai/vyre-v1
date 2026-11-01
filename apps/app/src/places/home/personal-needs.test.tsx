// A Personal Space's Home is the assistant and the checklist, and Needs you only when something waits on the person (a mailbox sign-in to repeat). With nothing waiting it stays out of the way.
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

installComposerForTests(Composer);

async function draw(variant: "northwind" | "firstrun") {
  const h = createSampleHomeB(variant, { aiConnected: variant === "northwind" });
  const { top, bottom } = homeBSlots(h.extras);
  const r = createRoot();
  await act(async () => { r.render(<Home data={h.data} top={top} bottom={bottom} personal />); });
  await flush(); await flush();
  return { root: r.container as unknown as Node, stop: async () => { await act(async () => { r.unmount(); }); } };
}

test("a Personal Home draws Needs you when something waits on the person, and not otherwise", async () => {
  const restore = installDom();
  const waiting = await draw("northwind");
  assert.ok(find(waiting.root, "s-needs"), "Needs you is drawn when there is something");
  assert.match(textOf(waiting.root), /Needs you/);
  await waiting.stop();
  const clear = await draw("firstrun");
  assert.equal(find(clear.root, "s-needs"), null, "and left out when nothing waits");
  await clear.stop();
  restore();
});
