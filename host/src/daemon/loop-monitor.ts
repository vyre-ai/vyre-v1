// The loop monitor of the real-server guard (test/loop.guard.server.live.test.ts, 27 Nov 2026). The guard starts vyred through main.ts as a child process, as an installer does, and this is what it runs inside it,
// only when VYRE_LOOP_MONITOR names a report file. It does three things and nothing else: a timer that notes every stretch the loop was not run for more than the bound (from the start of the process, so the imports and
// the whole boot are inside the window), a clock the test can move forward (SIGUSR2: ten minutes and a minute, then the scheduler's tick, as the in-process guard does with its clock), and the report, written when
// the process ends. The product never sets the variable.
import fs from "node:fs";
import { listenedAt } from "./boot-timing.ts";

interface Ticker {
  scheduler: { tick(): Promise<void>; runningNames(): string[] };
}
const file = process.env["VYRE_LOOP_MONITOR"] ?? "";
const bound = Number(process.env["VYRE_LOOP_BOUND_MS"] ?? 100);
const sample = 10;
const blocks: { at: number; ms: number }[] = [];
const ticks: { from: number; to: number }[] = [];
let skew = 0;
let started = false;

/** The server's clock: the real one, moved forward by the ticks the test asked for. */
export const now = (): number => Date.now() + skew;

/** The timer: from here on every stretch the loop is not run for longer than the bound is noted. */
export function startLoopMonitor(): void {
  if (started || !file) return;
  started = true;
  let last = performance.now();
  const timer = setInterval(() => {
    const at = performance.now();
    const lag = at - last - sample;
    if (lag > bound) blocks.push({ at: Math.round(at), ms: Math.round(lag) });
    last = at;
  }, sample);
  timer.unref();
  process.on("exit", () => {
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ wall0: Date.now() - performance.now(), bound, listenedAt, blocks, ticks }),
      );
    } catch {
      /* the test reads what is there */
    }
  });
}

/** Once the server listens: SIGUSR2 moves the clock ten minutes and a minute on and runs the scheduler's tick; "guard: tick done" is written when its jobs have finished. */
export function attachLoopMonitor(d: Ticker): void {
  if (!file) return;
  process.on("SIGUSR2", () => {
    skew += 600_000 + 61_000;
    const from = performance.now();
    void d.scheduler.tick().then(async () => {
      const until = Date.now() + 180_000;
      while (d.scheduler.runningNames().length && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
      ticks.push({ from: Math.round(from), to: Math.round(performance.now()) });
      process.stdout.write("guard: tick done\n");
    });
  });
}
