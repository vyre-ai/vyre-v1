// The tool catalog is built in the first idle tick after the engine module loads, not by the first agent turn (a 176 ms stretch).
import test from "node:test";
import assert from "node:assert/strict";
import { apiToolCatalogWarm } from "../api-tools.ts";
import "../impl.ts";

test("the first idle tick after the engine module loads leaves the tool catalog built", async () => {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(apiToolCatalogWarm(), true, "a turn finds the catalog warm");
});
