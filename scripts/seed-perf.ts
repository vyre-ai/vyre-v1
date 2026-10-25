// Builds (or finds) the perf Space template and prints where it is and how long the build took.
//   node scripts/seed-perf.ts [--scale full|ci] [--cache <dir>]
// The template is cached by the hash of the recipe, the core sources and the registry hash, so a second run is a lookup.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERF_SIZES, bootPerf, lastPerfBuild } from "../fixtures/seed/perf/build.ts";
import type { PerfScale } from "../fixtures/seed/perf/build.ts";

export interface SeedPerfReport { scale: PerfScale; hit: boolean; key: string; sizes: (typeof PERF_SIZES)[PerfScale]; gaps: string[]; readyMs: number; build: ReturnType<typeof lastPerfBuild> }

/** The whole script: `argv` is what follows the file name. */
export async function seedPerf(argv: readonly string[]): Promise<SeedPerfReport> {
  const arg = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const scale = (arg("--scale") ?? "full") as PerfScale;
  if (!(scale in PERF_SIZES)) throw new Error(`unknown scale ${scale}: use full or ci`);
  const cache = arg("--cache");
  const t0 = performance.now();
  const space = await bootPerf({ scale, ...(cache ? { cache } : {}) });
  const readyMs = Math.round(performance.now() - t0);
  space.close();
  return { scale: space.scale, hit: space.hit, key: space.key, sizes: space.sizes, gaps: space.gaps, readyMs, build: lastPerfBuild() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await seedPerf(process.argv.slice(2)))); } catch (e) { console.error((e as Error).message); process.exit(2); }
}
