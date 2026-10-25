// Builds (or finds) the perf Space template and prints where it is and how long the build took.
//   node scripts/seed-perf.ts [--scale full|ci] [--cache <dir>]
// The template is cached by the hash of the recipe, the core sources and the registry hash, so a second run is a lookup.
import { PERF_SIZES, bootPerf, lastPerfBuild } from "../fixtures/seed/perf/build.ts";
import type { PerfScale } from "../fixtures/seed/perf/build.ts";

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const scale = (arg("--scale") ?? "full") as PerfScale;
if (!(scale in PERF_SIZES)) { console.error(`unknown scale ${scale}: use full or ci`); process.exit(2); }
const cache = arg("--cache");

const t0 = performance.now();
const space = await bootPerf({ scale, ...(cache ? { cache } : {}) });
const ms = performance.now() - t0;
console.log(JSON.stringify({ scale: space.scale, hit: space.hit, key: space.key, sizes: space.sizes, gaps: space.gaps, readyMs: Math.round(ms), build: lastPerfBuild() }));
space.close();
