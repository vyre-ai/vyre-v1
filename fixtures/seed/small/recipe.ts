// The `small` seed recipe, a skeleton (ARCH 10.3, F6): the frozen core plus every module's own `modules/*/fixtures/seed.ts`, found by glob so no lane edits a shared seed file. Built for real at hour 6.
// Target size: about 500 records, 40 channels, 12 agents, 6 people with every role.
import fs from "node:fs";
import path from "node:path";
import { REPO } from "../core/index.ts";

export const SMALL_TARGET = Object.freeze({ records: 500, channels: 40, agents: 12, people: 6 });

/** Module seed files under `root`, one per module that has `fixtures/seed.ts`, sorted by module id. */
export function discoverSeeds(root: string = REPO): { module: string; file: string }[] {
  const dir = path.join(root, "modules");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ module: d.name, file: path.join(dir, d.name, "fixtures/seed.ts") }))
    .filter((s) => fs.existsSync(s.file)).sort((a, b) => (a.module < b.module ? -1 : 1));
}

export function smallRecipe(root: string = REPO): { name: "small"; target: typeof SMALL_TARGET; seeds: { module: string; file: string }[] } {
  return { name: "small", target: SMALL_TARGET, seeds: discoverSeeds(root) };
}
