// A test/slow.json entry with "perf": true is a speed test. Speed numbers count only on the pinned perf host (ruling 46), so every other shard leaves the file out and
// prints one "skip (perf)" line for it. It runs when VYRE_PERF_FULL=1 (the hourly perf.yml run) or VYRE_PERF_RUN=1 (a v1-perf matrix entry, set by the workflows).

/** True when this process is allowed to run perf files. @param {Record<string, string | undefined>} env */
export function perfAllowed(env) {
  return env["VYRE_PERF_FULL"] === "1" || env["VYRE_PERF_RUN"] === "1";
}

/**
 * Splits files into those to run and the perf files to skip.
 * @param {string[]} files @param {{ file: string, perf?: boolean }[]} slow @param {Record<string, string | undefined>} env
 */
export function splitPerf(files, slow, env) {
  if (perfAllowed(env)) return { run: files, skipped: [] };
  const perf = new Set(slow.filter((s) => s.perf === true).map((s) => s.file));
  return { run: files.filter((f) => !perf.has(f)), skipped: files.filter((f) => perf.has(f)) };
}
