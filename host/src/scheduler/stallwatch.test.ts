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

test("the watchdog opens no inspector port or socket, logs frames only (no locals, no argument values), and says one line per stall", async () => {
  const script = SCRIPT.replace(
    "function holdTheLoopForAWhile() {",
    'import("node:inspector").then((m) => process.stdout.write("URL:" + String(m.default.url()) + "\\n"));\nfunction holdTheLoopForAWhile(secretArgument = "sk_live_ARGVALUE") { const secretLocal = "sk_live_LOCALVALUE" + secretArgument;',
  ).replace("holdTheLoopForAWhile();", 'holdTheLoopForAWhile("sk_live_ARGVALUE");');
  const out: string[] = [];
  const err: string[] = [];
  const p = run(script);
  p.stdout.on("data", (d) => out.push(String(d)));
  p.stderr.on("data", (d) => err.push(String(d)));
  await new Promise((r) => p.on("exit", r));
  const lines = err
    .join("")
    .split("\n")
    .filter((l) => l.includes("scheduler.loop_stalled"));
  assert.equal(lines.length, 1, `one line for one stall: ${err.join("").slice(0, 400)}`);
  assert.ok(!err.join("").includes("sk_live_"), "no value of a variable or an argument is in the line");
  assert.ok(out.join("").includes("URL:undefined"), "the inspector listens on nothing");
  assert.deepEqual(Object.keys(JSON.parse(lines[0]!)).sort(), ["level", "lateMs", "msg", "stack"].sort());
});

test("a loop that stalls again and again is logged at most the limit a minute", async () => {
  const script = `
import { startStallWatch } from ${JSON.stringify(fileURLToPath(new URL("./stallwatch.ts", import.meta.url)))};
startStallWatch({ stallMs: 150, maxPerMinute: 2 });
const hold = (ms) => { const t = Date.now(); while (Date.now() - t < ms) {} };
for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 300)); hold(500); }
await new Promise((r) => setTimeout(r, 300));
process.exit(0);
`;
  const err: string[] = [];
  const p = run(script);
  p.stderr.on("data", (d) => err.push(String(d)));
  await new Promise((r) => p.on("exit", r));
  assert.equal(
    err
      .join("")
      .split("\n")
      .filter((l) => l.includes("loop_stalled")).length,
    2,
  );
});

test("a healthy loop costs nothing measurable: the same idle second burns the same cpu with the watchdog on", async () => {
  const script = (on: boolean) => `
import { startStallWatch } from ${JSON.stringify(fileURLToPath(new URL("./stallwatch.ts", import.meta.url)))};
${on ? "startStallWatch();" : ""}
await new Promise((r) => setTimeout(r, 300));
const c0 = process.cpuUsage();
const t0 = performance.now();
let ticks = 0, worst = 0, last = performance.now();
const iv = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 10); last = n; ticks++; }, 10);
await new Promise((r) => setTimeout(r, 2000));
clearInterval(iv);
const c = process.cpuUsage(c0);
process.stdout.write(JSON.stringify({ cpuMs: (c.user + c.system) / 1000, worst, ticks }));
process.exit(0);
`;
  const measure = async (on: boolean) => {
    const out: string[] = [];
    const p = run(script(on));
    p.stdout.on("data", (d) => out.push(String(d)));
    await new Promise((r) => p.on("exit", r));
    return JSON.parse(out.join("")) as { cpuMs: number; worst: number; ticks: number };
  };
  const off = await measure(false);
  const on = await measure(true);
  process.stderr.write(
    `[stallwatch] idle 2 s: cpu ${off.cpuMs.toFixed(1)} ms off, ${on.cpuMs.toFixed(1)} ms on; worst timer lateness ${off.worst.toFixed(1)} ms off, ${on.worst.toFixed(1)} ms on\n`,
  );
  assert.ok(on.cpuMs - off.cpuMs < 30, `extra cpu over 2 s: ${(on.cpuMs - off.cpuMs).toFixed(1)} ms`);
  assert.ok(on.worst < 25, `the loop was never held: worst lateness ${on.worst.toFixed(1)} ms`);
});
