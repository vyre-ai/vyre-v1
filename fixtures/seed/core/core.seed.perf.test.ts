// The speed half of core.seed.test.ts (split out so that only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { Req } from "../../../kernel/src/authorize/index.ts";
import { canonical } from "../../../lib/canonical.ts";
import { AGENTS, CORE_SOURCES, CORE_SPACE, FOLDERS, GROUPS, PEOPLE, bootCore, coreEvents, ensureTemplate, registryHash, templateKey } from "./index.ts";
import { discoverSeeds } from "../small/recipe.ts";
import { smallRecipe, SMALL_TARGET } from "../small/recipe.ts";
import { perfRecipe, PERF_TARGET } from "../perf/recipe.ts";

/** The frozen shape: sha-256 of the recipe's events (type, entity, id, payload). Only the lead changes it, together with the recipe. */
const CORE_SHAPE_HASH = "d59162903db6b5c52e02f0528f2b07fcf2d5bd8adcfd1d8353b156685099b502";
const shapeHash = (): string => crypto.createHash("sha256").update(canonical(coreEvents().map((e) => [e.type, e.entity, e.entity_id, e.payload]))).digest("hex");

const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "core-seed-"));
const can = (snap: ReturnType<typeof bootCore>["snapshot"], principal: string, perm: string | null, level: Req["action"]["level"], resource: Req["resource"]): string =>
  authorize(snap, { principal, action: { perm, level }, resource, now: 1_790_000_000_000 }).effect;

test("PERF: core boots in under 100 ms on a template cache hit", () => {
  const cache = scratch(), sc = scratch();
  bootCore({ cache, scratch: sc }).close();             // build the template
  const times: number[] = [];
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    const c = bootCore({ cache, scratch: sc });
    times.push(performance.now() - t0);
    assert.equal(c.hit, true);
    c.close();
  }
  times.sort((a, b) => a - b);
  const median = times[3]!;
  console.log(`core boot on a cache hit: median ${median.toFixed(1)} ms, min ${times[0]!.toFixed(1)} ms, max ${times[6]!.toFixed(1)} ms (budget 100 ms)`);
  assert.ok(median < 100, `median ${median.toFixed(1)} ms is over the 100 ms budget`);
  assert.ok(times[6]! < 100 * 3, "even the slowest boot stays near the budget");
});
