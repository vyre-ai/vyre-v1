// Boot stall guard: a Space that is started again (its tables and files exist, with a few agents in it) never holds the event loop for more than 100 ms of CPU between the start of the daemon and three seconds
// after it serves, whatever job or hook runs then. A first start on an empty data directory writes the tables of every module and is not held to this (nor is the one-time load of the code, which
// happens before anything serves). A restart that blocked 180 ms in loadRegistry (parsed three times) is what this caught first (Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { boot, call, seededDir } from "./support/eco-live.ts";

const BUDGET_MS = 100;
const stand = (): never => (async function* () {})() as never;

test(
  "a restarted Space with agents holds the event loop for at most 100 ms while it boots and settles",
  { timeout: 180_000 },
  async () => {
    const dir = seededDir();
    const first = await boot(dir, stand());
    for (const name of ["Scout", "Helper", "Intake"]) {
      const r = await call(first, "agents.create", { name });
      assert.ok(r.status === 200 || r.status === 422, `agents.create ${name}: ${r.status}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
    await first.stop();
    // the code is loaded and the tables are written: from here on it is the start of a Space that exists
    // The work of a stretch is the CPU the thread spent between two ticks of a 5 ms timer, not the time that went by: a loaded runner (another process, a paused machine) stretches the time and not the CPU.
    // The time between ticks is kept as a printed diagnostic.
    const threadCpu = (
      process as unknown as { threadCpuUsage?: () => { user: number; system: number } }
    ).threadCpuUsage?.bind(process);
    const cpu = (): number => {
      if (!threadCpu) return performance.now();
      const u = threadCpu();
      return (u.user + u.system) / 1000;
    };
    let last = performance.now();
    let lastCpu = cpu();
    let worst = 0;
    let worstWall = 0;
    const timer = setInterval(() => {
      const at = performance.now();
      const c = cpu();
      worst = Math.max(worst, c - lastCpu);
      worstWall = Math.max(worstWall, at - last - 5);
      last = at;
      lastCpu = c;
    }, 5);
    const second = await boot(dir, stand());
    await new Promise((r) => setTimeout(r, 3000));
    clearInterval(timer);
    second.sink.flush();
    const reports = (
      new DatabaseSync(second.paths.logs, { readOnly: true })
        .prepare("SELECT attrs FROM logs WHERE msg LIKE '%loop_blocked%' ORDER BY id DESC LIMIT 20")
        .all() as Array<{ attrs: string }>
    ).map((r) => JSON.parse(r.attrs ?? "{}") as { lagMs?: number; jobs?: string[] });
    await second.stop();
    process.stderr.write(
      `[boot-guard] longest stretch ${Math.round(worst)} ms of CPU (${Math.round(worstWall)} ms of time); the daemon's own reports in this log: ${JSON.stringify(reports)}\n`,
    );
    assert.ok(
      worst <= BUDGET_MS,
      `one stretch of the boot was ${Math.round(worst)} ms of CPU (budget ${BUDGET_MS} ms; ${Math.round(worstWall)} ms of time)`,
    );
  },
);
