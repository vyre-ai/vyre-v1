// CPU time of a synchronous call, for timing tests that must not fail because a busy runner stole the clock (rc.43: a case that takes 30 ms of CPU read
// 437 ms of wall time in CI). One run, no best-of-N: code that is quadratic on the input burns CPU in every run, so the limit stays honest.
// process.threadCpuUsage (Node 23.9 and later) counts only this thread; process.cpuUsage is the fallback and counts the whole process, which is
// the same thing in a test that runs one synchronous call.

export interface Timed<T> {
  out: T;
  /** CPU milliseconds the call used (user + system). */
  cpuMs: number;
  /** Wall-clock milliseconds, for a hang guard only. */
  wallMs: number;
}

const usage = (): { user: number; system: number } => {
  const p = process as unknown as { threadCpuUsage?: () => { user: number; system: number } };
  return typeof p.threadCpuUsage === "function" ? p.threadCpuUsage() : process.cpuUsage();
};

/** Runs `fn` once and measures it. */
export function timeCpu<T>(fn: () => T): Timed<T> {
  const w0 = performance.now();
  const c0 = usage();
  const out = fn();
  const c1 = usage();
  return { out, cpuMs: (c1.user - c0.user + (c1.system - c0.system)) / 1000, wallMs: performance.now() - w0 };
}

/** The wall-clock ceiling for a case with a CPU limit: ten times the limit, there only to catch a hang. */
export const wallCeiling = (cpuLimitMs: number): number => cpuLimitMs * 10;
