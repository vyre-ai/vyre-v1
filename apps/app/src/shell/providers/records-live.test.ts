// A runtime whose hooks cannot answer a capability query gives a query that stays loading: and it must hand React the same snapshot object every time, or React loops ("getSnapshot should be cached").
import test from "node:test";
import assert from "node:assert/strict";
import { capLive } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

test("a runtime without capQuery gives a loading query with one stable snapshot", () => {
  const q = capLive({ screens: {} } as unknown as ShellRuntime, "tasks.list", { scope: "mine" });
  const a = q.getSnapshot();
  assert.equal(a.status, "loading");
  assert.equal(q.getSnapshot(), a, "the same object on every read");
  assert.equal(capLive({ screens: {} } as unknown as ShellRuntime, "x").getSnapshot(), a, "and the same one for every such query");
});
