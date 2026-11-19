import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (script: string) => {
  const dir = mkdtempSync(join(tmpdir(), "stall-"));
  const file = join(dir, "main.mjs");
  writeFileSync(file, script);
  return spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
};

const SCRIPT = `
import { startStallWatch } from ${JSON.stringify(fileURLToPath(new URL("./stallwatch.ts", import.meta.url)))};
startStallWatch({ stallMs: 300 });
await new Promise((r) => setTimeout(r, 400));
function holdTheLoopForAWhile() { const t = Date.now(); while (Date.now() - t < 1500) { /* busy */ } }
holdTheLoopForAWhile();
await new Promise((r) => setTimeout(r, 400));
process.exit(0);
`;

test("a stall over the limit names the code that held the loop, from a thread of its own", async () => {
  const out: string[] = [];
  const p = run(SCRIPT);
  p.stderr.on("data", (d) => out.push(String(d)));
  await new Promise((r) => p.on("exit", r));
  const line = out
    .join("")
    .split("\n")
    .find((l) => l.includes("scheduler.loop_stalled"));
  assert.ok(line, `a stall line was written: ${out.join("").slice(0, 300)}`);
  const rec = JSON.parse(line!) as { stack: string[]; lateMs: number };
  assert.ok(rec.lateMs >= 300);
  assert.ok(
    rec.stack.some((f) => f.includes("holdTheLoopForAWhile")),
    `the stack names the function: ${JSON.stringify(rec.stack)}`,
  );
});

test("a loop that is never held writes nothing", async () => {
  const out: string[] = [];
  const quiet = SCRIPT.replace("while (Date.now() - t < 1500)", "while (Date.now() - t < 10)");
  const p = run(quiet);
  p.stderr.on("data", (d) => out.push(String(d)));
  await new Promise((r) => p.on("exit", r));
  assert.ok(!out.join("").includes("loop_stalled"));
});
