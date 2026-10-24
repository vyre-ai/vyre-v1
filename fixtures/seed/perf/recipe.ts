// The `perf` seed recipe, a skeleton (ARCH 10.3 and 9): the small seed's shape at the sizes the budgets are measured on. Module seeds are found the same way as for `small`.
import { REPO } from "../core/index.ts";
import { discoverSeeds } from "../small/recipe.ts";

export const PERF_TARGET = Object.freeze({ records: 100_000, channels: 200, messages: 50_000, agents: 12, people: 6 });

export function perfRecipe(root: string = REPO): { name: "perf"; target: typeof PERF_TARGET; seeds: { module: string; file: string }[] } {
  return { name: "perf", target: PERF_TARGET, seeds: discoverSeeds(root) };
}
