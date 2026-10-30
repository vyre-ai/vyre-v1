// The chat benchmark runner: all 30 tasks, before and after the turn context, on two identical seeded Spaces. The two sides run in two processes side by side (a daemon keeps its engine in module
// state, so two cannot share one process).
//   node --experimental-strip-types test/chat-brain.benchmark.ts            prints the table
//   VYRE_BENCH_OUT=/path/scores.json node ... test/chat-brain.benchmark.ts   also writes the scores as JSON
//   VYRE_BENCH_DEBUG=1 ...                                                    prints every tool call a policy makes and the host log of a failed task
// test/chat-brain.bench.test.ts runs each side as a test on every change.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ORDER, TASKS, runMode, score } from "./support/bench-tasks.ts";
import type { Result } from "./support/bench-tasks.ts";

/** The table: one row per task with both sides and the tool calls each took, then the areas and the totals. */
export function report(before: readonly Result[], after: readonly Result[]): string {
  const lines = ["task".padEnd(22) + "before".padEnd(8) + "after".padEnd(8) + "tool calls b/a"];
  for (const id of ORDER) {
    const b = before.find((r) => r.id === id), a = after.find((r) => r.id === id);
    if (!b || !a) continue;
    lines.push(id.padEnd(22) + (b.pass ? "pass" : "FAIL").padEnd(8) + (a.pass ? "pass" : "FAIL").padEnd(8) + `${b.calls}/${a.calls}${b.pass && a.pass ? "" : `   ${b.pass ? "" : `before: ${b.why}`}${a.pass ? "" : ` after: ${a.why}`}`}`);
  }
  for (const area of [...new Set(TASKS.map((t) => t.area))]) {
    const b = score(before.filter((r) => r.area === area)), a = score(after.filter((r) => r.area === area));
    lines.push(`${area.padEnd(12)} before ${b.pass}/${b.total}   after ${a.pass}/${a.total}`);
  }
  const sb = score(before), sa = score(after);
  lines.push(`TOTAL        before ${sb.pass}/${sb.total} (${sb.calls} tool calls)   after ${sa.pass}/${sa.total} (${sa.calls} tool calls)`);
  return lines.join("\n");
}

const here = fileURLToPath(import.meta.url);
const runSide = (mode: "before" | "after"): Promise<Result[]> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["--experimental-strip-types", here, "--side", mode], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
  child.on("exit", (code) => {
    const line = out.split("\n").find((l) => l.startsWith("@@RESULT "));
    if (code === 0 && line) resolve(JSON.parse(line.slice(9)) as Result[]);
    else reject(new Error(`the ${mode} side exited with ${code}: ${out.slice(-800)}`));
  });
});

async function main(): Promise<void> {
  if (process.argv[2] === "--side") {
    fs.writeSync(1, `\n@@RESULT ${JSON.stringify(await runMode(process.argv[3] as "before" | "after"))}\n`);
    return;
  }
  const [before, after] = await Promise.all([runSide("before"), runSide("after")]);
  console.log(report(before, after));
  if (process.env["VYRE_BENCH_OUT"]) fs.writeFileSync(process.env["VYRE_BENCH_OUT"], JSON.stringify({ before, after, sb: score(before), sa: score(after) }, null, 1));
}

if (process.argv[1] === here) { await main(); process.exit(0); }
