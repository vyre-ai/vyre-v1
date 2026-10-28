// Crash resume across two OS processes. The driver is SIGKILLed while a step is running, then started again on the same SQLite files.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER = fileURLToPath(new URL("./killed-host-driver.ts", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOUR = 3_600_000;

interface Sql {
  prepare(source: string): { all(...args: unknown[]): Record<string, unknown>[]; get(...args: unknown[]): Record<string, unknown> | undefined };
  close(): void;
}
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => Sql };

interface Effect { cap: string; input: Record<string, unknown> }
interface Step { run_id: string; step: string; attempt: number; state: string }
interface Item { id: string; status: string; parent_run: string | null; summary: string | null }
interface Link { run_id: string; parent_run: string | null; scope: { iterationKey?: string; laneId?: string; held?: boolean; containerNodeId?: string } | null }
interface Snap {
  effects: Effect[];
  steps: Step[];
  items: Item[];
  links: Link[];
  claims: string[];
  tasks: { id: string; state: string; source_id: string | null }[];
  report: Record<string, unknown> | null;
}

interface Proc { child: ChildProcess; output: { stderr: string; stdout: string } }

function start(dir: string, args: string[]): Proc {
  const child = spawn(process.execPath, ["--experimental-strip-types", DRIVER, "--dir", dir, ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stderr: "", stdout: "" };
  child.stderr?.setEncoding("utf8");
  child.stdout?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { output.stderr += chunk; });
  child.stdout?.on("data", (chunk: string) => { output.stdout += chunk; });
  return { child, output };
}

function waitExit(child: ChildProcess, ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("child did not exit")), ms);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function readReady(file: string): { pid: number; step: string } | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const body = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown; step?: unknown };
    if (typeof body.pid === "number" && typeof body.step === "string") return { pid: body.pid, step: body.step };
  } catch { /* the rename has not landed */ }
  return undefined;
}

async function waitReady(file: string, proc: Proc, ms: number): Promise<{ pid: number; step: string }> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const body = readReady(file);
    if (body) return body;
    if (proc.child.exitCode !== null || proc.child.signalCode) {
      throw new Error(`driver exited early code=${proc.child.exitCode} signal=${proc.child.signalCode}\n${proc.output.stderr}\n${proc.output.stdout}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  if (proc.child.pid) process.kill(proc.child.pid, "SIGKILL");
  throw new Error(`ready file timed out\n${proc.output.stderr}\n${proc.output.stdout}`);
}

async function killAt(dir: string, args: string[], step: string): Promise<number> {
  await rm(path.join(dir, "ready.json"), { force: true });
  const proc = start(dir, args);
  try {
    const ready = await waitReady(path.join(dir, "ready.json"), proc, 45_000);
    assert.equal(ready.step, step, proc.output.stderr);
    assert.equal(ready.pid, proc.child.pid);
    assert.notEqual(ready.pid, process.pid);
    const exited = waitExit(proc.child, 5_000);
    process.kill(ready.pid, "SIGKILL");
    const result = await exited;
    assert.equal(result.signal, "SIGKILL", proc.output.stderr);
    assert.equal(result.code, null);
    return ready.pid;
  } catch (e) {
    if (proc.child.exitCode === null && proc.child.signalCode === null && proc.child.pid) process.kill(proc.child.pid, "SIGKILL");
    throw e;
  }
}

async function runToExit(dir: string, args: string[]): Promise<number> {
  const proc = start(dir, args);
  try {
    const result = await waitExit(proc.child, 60_000);
    assert.equal(result.code, 0, `${proc.output.stderr}\n${proc.output.stdout}`);
    assert.equal(result.signal, null);
    const report = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as { pid?: number };
    assert.equal(typeof report.pid, "number");
    assert.notEqual(report.pid, process.pid);
    return report.pid as number;
  } catch (e) {
    if (proc.child.exitCode === null && proc.child.signalCode === null && proc.child.pid) process.kill(proc.child.pid, "SIGKILL");
    throw e;
  }
}

function snap(dir: string): Snap {
  const open = (file: string): Sql => new DatabaseSync(path.join(dir, file), { readOnly: true });
  const runs = open("runs.sqlite");
  const autos = open("automations.sqlite");
  const meta = open("meta.sqlite");
  const effects = meta.prepare("SELECT cap, input FROM effects ORDER BY id").all().map((row) => ({ cap: String(row.cap), input: JSON.parse(String(row.input)) as Record<string, unknown> }));
  const steps = runs.prepare("SELECT run_id, step, attempt, state FROM runs_steps ORDER BY run_id, ord, attempt").all().map((row) => ({
    run_id: String(row.run_id), step: String(row.step), attempt: Number(row.attempt), state: String(row.state),
  }));
  const items = runs.prepare("SELECT id, status, parent_run, summary FROM runs_items").all().map((row) => ({
    id: String(row.id), status: String(row.status), parent_run: row.parent_run == null ? null : String(row.parent_run), summary: row.summary == null ? null : String(row.summary),
  }));
  const links = autos.prepare("SELECT run_id, parent_run, scope FROM automations_runs").all().map((row) => ({
    run_id: String(row.run_id),
    parent_run: row.parent_run == null ? null : String(row.parent_run),
    scope: row.scope == null ? null : JSON.parse(String(row.scope)) as Link["scope"],
  }));
  const claims = meta.prepare("SELECT tick_id FROM claims ORDER BY tick_id").all().map((row) => String(row.tick_id));
  const tasks = meta.prepare("SELECT id, state, source_id FROM tasks ORDER BY id").all().map((row) => ({
    id: String(row.id), state: String(row.state), source_id: row.source_id == null ? null : String(row.source_id),
  }));
  runs.close();
  autos.close();
  meta.close();
  let report: Record<string, unknown> | null = null;
  const reportFile = path.join(dir, "report.json");
  if (existsSync(reportFile)) report = JSON.parse(readFileSync(reportFile, "utf8")) as Record<string, unknown>;
  return { effects, steps, items, links, claims, tasks, report };
}

function show(db: Snap): string {
  return JSON.stringify({ runs: db.items, steps: db.steps, effects: db.effects, links: db.links, claims: db.claims, tasks: db.tasks }, null, 2);
}

const caps = (db: Snap, cap: string): Record<string, unknown>[] => db.effects.filter((row) => row.cap === cap).map((row) => row.input);
const parents = (db: Snap): Item[] => db.items.filter((row) => row.parent_run == null);
const stepsOf = (db: Snap, runId: string, step: string): Step[] => db.steps.filter((row) => row.run_id === runId && row.step === step);
const patchSteps = (db: Snap): unknown[] => caps(db, "records.update").map((row) => (row.patch as { step?: string } | undefined)?.step);
const names = (db: Snap): unknown[] => caps(db, "records.create").map((row) => (row.fields as { name?: string } | undefined)?.name);

async function withDir(name: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = `/tmp/vyre-killed-host-${process.pid}/${name}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
    await rm(dir, { recursive: true, force: true });
  } catch (e) {
    console.error(`kept ${dir}`);
    throw e;
  }
}

describe("killed host", { concurrency: 1 }, () => {
  test("a parked wait resumes once after SIGKILL and a second recovery does not send twice", async () => {
    await withDir("wait", async (dir) => {
      const killed = await killAt(dir, ["--scenario", "wait", "--phase", "boot", "--stall", "pause"], "pause");
      const mid = snap(dir);
      const parent = parents(mid)[0];
      assert.ok(parent, show(mid));
      assert.equal(parent.status, "running", show(mid));
      assert.deepEqual(stepsOf(mid, parent.id, "pause").map((row) => [row.attempt, row.state]), [[1, "running"]], show(mid));
      assert.equal(caps(mid, "mail.send").length, 0, show(mid));

      const resumed = await runToExit(dir, ["--scenario", "wait", "--phase", "recover"]);
      assert.notEqual(resumed, killed);
      const parked = snap(dir);
      assert.equal(parents(parked)[0]?.status, "waiting", show(parked));
      assert.deepEqual(stepsOf(parked, parent.id, "pause").map((row) => [row.attempt, row.state]), [[1, "waiting"]], show(parked));
      assert.equal(caps(parked, "mail.send").length, 0, show(parked));
      assert.equal(stepsOf(parked, parent.id, "mail").length, 0, show(parked));

      const sentBy = await runToExit(dir, ["--scenario", "wait", "--phase", "recover", "--advance", String(HOUR), "--again"]);
      assert.notEqual(sentBy, killed);
      const sent = snap(dir);
      assert.equal(parents(sent)[0]?.status, "succeeded", show(sent));
      assert.equal(caps(sent, "mail.send").length, 1, show(sent));
      assert.deepEqual(stepsOf(sent, parent.id, "pause").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(sent));
      assert.deepEqual(stepsOf(sent, parent.id, "mail").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(sent));

      const again = await runToExit(dir, ["--scenario", "wait", "--phase", "recover", "--again"]);
      assert.notEqual(again, sentBy);
      const twice = snap(dir);
      assert.equal(caps(twice, "mail.send").length, 1, show(twice));
      assert.equal(stepsOf(twice, parent.id, "mail").length, 1, show(twice));
      assert.equal(parents(twice)[0]?.status, "succeeded", show(twice));
    });
  });

  test("a loop wait resumes the same child and attempt after SIGKILL and does not add a child", async () => {
    await withDir("loop", async (dir) => {
      const killed = await killAt(dir, ["--scenario", "loop", "--phase", "boot", "--stall", "hold"], "hold");
      const mid = snap(dir);
      const parent = parents(mid)[0];
      assert.ok(parent, show(mid));
      const kids = mid.links.filter((row) => row.parent_run === parent.id);
      assert.equal(kids.length, 3, show(mid));
      const ada = kids.find((row) => row.scope?.iterationKey === "a");
      assert.ok(ada, show(mid));
      assert.equal(mid.items.find((row) => row.id === ada.run_id)?.status, "running", show(mid));
      assert.deepEqual(stepsOf(mid, ada.run_id, "make").map((row) => row.state), ["succeeded"], show(mid));
      assert.deepEqual(stepsOf(mid, ada.run_id, "hold").map((row) => [row.attempt, row.state]), [[1, "running"]], show(mid));
      assert.deepEqual(names(mid), ["Ada"], show(mid));
      for (const key of ["b", "c"]) {
        const child = kids.find((row) => row.scope?.iterationKey === key);
        assert.equal(child?.scope?.held, true, show(mid));
        assert.equal(mid.steps.filter((row) => row.run_id === child?.run_id).length, 0, show(mid));
      }

      const resumed = await runToExit(dir, ["--scenario", "loop", "--phase", "recover"]);
      assert.notEqual(resumed, killed);
      const parked = snap(dir);
      const parkedKids = parked.links.filter((row) => row.parent_run === parent.id);
      assert.equal(parkedKids.length, 3, show(parked));
      const same = parkedKids.find((row) => row.scope?.iterationKey === "a");
      assert.equal(same?.run_id, ada.run_id, show(parked));
      assert.equal(parked.items.find((row) => row.id === ada.run_id)?.status, "waiting", show(parked));
      assert.deepEqual(stepsOf(parked, ada.run_id, "hold").map((row) => [row.attempt, row.state]), [[1, "waiting"]], show(parked));
      assert.deepEqual(names(parked), ["Ada"], show(parked));

      const continuedBy = await runToExit(dir, ["--scenario", "loop", "--phase", "recover", "--advance", String(HOUR), "--again"]);
      assert.notEqual(continuedBy, resumed);
      const done = snap(dir);
      const after = done.links.filter((row) => row.parent_run === parent.id);
      assert.equal(after.length, 3, show(done));
      assert.deepEqual(after.map((row) => row.run_id).sort(), kids.map((row) => row.run_id).sort(), show(done));
      assert.equal(done.items.find((row) => row.id === ada.run_id)?.status, "succeeded", show(done));
      assert.deepEqual(stepsOf(done, ada.run_id, "make").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(done));
      assert.deepEqual(stepsOf(done, ada.run_id, "hold").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(done));
      assert.deepEqual(names(done), ["Ada", "Bea"], show(done));
      const bea = after.find((row) => row.scope?.iterationKey === "b");
      assert.ok(bea, show(done));
      assert.equal(bea.scope?.held, false, show(done));
      assert.equal(done.items.find((row) => row.id === bea.run_id)?.status, "waiting", show(done));
      assert.deepEqual(stepsOf(done, bea.run_id, "hold").map((row) => [row.attempt, row.state]), [[1, "waiting"]], show(done));
      const cy = after.find((row) => row.scope?.iterationKey === "c");
      assert.equal(cy?.scope?.held, true, show(done));
      assert.equal(done.steps.filter((row) => row.run_id === cy?.run_id).length, 0, show(done));
      assert.equal(caps(done, "records.create").length, 2, show(done));
    });
  });

  test("a schedule over its cap does not open a second Needs You task or start a claimed tick after SIGKILL", async () => {
    await withDir("schedule", async (dir) => {
      const killed = await killAt(dir, ["--scenario", "schedule", "--phase", "boot", "--stall", "fire"], "fire");
      const mid = snap(dir);
      assert.equal(caps(mid, "tasks.create").length, 1, show(mid));
      assert.equal(mid.tasks.length, 1, show(mid));
      assert.equal(mid.tasks[0]?.state, "todo", show(mid));
      assert.match(mid.tasks[0]?.source_id ?? "", /^automation-schedule:/, show(mid));
      assert.equal(caps(mid, "automations.fire").length, 5, show(mid));
      assert.equal(mid.claims.length, 5, show(mid));
      assert.equal(mid.items.length, 5, show(mid));
      assert.equal(caps(mid, "notifications.send").length, 2, show(mid));

      const resumed = await runToExit(dir, ["--scenario", "schedule", "--phase", "recover"]);
      assert.notEqual(resumed, killed);
      const after = snap(dir);
      assert.equal(after.report?.firstCreated, false, show(after));
      assert.equal(after.report?.firstStarted, 0, show(after));
      assert.equal(after.report?.firstIgnored, 5, show(after));
      assert.equal(after.report?.secondCreated, false, show(after));
      assert.equal(after.report?.secondStarted, 0, show(after));
      assert.equal(after.report?.secondIgnored, 5, show(after));
      assert.equal(caps(after, "tasks.create").length, 1, show(after));
      assert.equal(after.tasks.length, 1, show(after));
      assert.equal(after.tasks[0]?.id, mid.tasks[0]?.id, show(after));
      assert.equal(caps(after, "automations.fire").length, 5, show(after));
      assert.equal(after.claims.length, 5, show(after));
      assert.deepEqual(after.claims, mid.claims, show(after));
      assert.equal(after.items.length, 5, show(after));
      assert.deepEqual(after.items.map((row) => row.id).sort(), mid.items.map((row) => row.id).sort(), show(after));
      assert.equal(caps(after, "notifications.send").length, 2, show(after));
    });
  });

  test("each inner node of one definition resumes once after SIGKILL", async () => {
    await withDir("graph", async (dir) => {
      const killedWork = await killAt(dir, ["--scenario", "graph", "--phase", "boot", "--stall", "work"], "work");
      const atWork = snap(dir);
      const parent = parents(atWork)[0];
      assert.ok(parent, show(atWork));
      assert.deepEqual(stepsOf(atWork, parent.id, "work").map((row) => [row.attempt, row.state]), [[1, "running"]], show(atWork));
      assert.deepEqual(patchSteps(atWork), [], show(atWork));

      const killedPause = await killAt(dir, ["--scenario", "graph", "--phase", "recover", "--stall", "pause"], "pause");
      assert.notEqual(killedPause, killedWork);
      const atPause = snap(dir);
      assert.deepEqual(stepsOf(atPause, parent.id, "work").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(atPause));
      assert.deepEqual(patchSteps(atPause), ["work"], show(atPause));
      assert.deepEqual(stepsOf(atPause, parent.id, "pause").map((row) => [row.attempt, row.state]), [[1, "running"]], show(atPause));

      const killedLane = await killAt(dir, ["--scenario", "graph", "--phase", "recover", "--stall", "lane", "--advance", String(HOUR)], "lane");
      assert.notEqual(killedLane, killedPause);
      const atLane = snap(dir);
      assert.deepEqual(stepsOf(atLane, parent.id, "pause").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(atLane));
      assert.deepEqual(patchSteps(atLane), ["work", "other"], show(atLane));
      const lane = atLane.links.find((row) => row.parent_run === parent.id && row.scope?.laneId === "Lane");
      const other = atLane.links.find((row) => row.parent_run === parent.id && row.scope?.laneId === "Other");
      assert.ok(lane && other, show(atLane));
      assert.deepEqual(stepsOf(atLane, lane.run_id, "lane").map((row) => [row.attempt, row.state]), [[1, "running"]], show(atLane));
      assert.deepEqual(stepsOf(atLane, other.run_id, "other").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(atLane));
      assert.equal(atLane.links.filter((row) => row.scope?.containerNodeId === "par").length, 2, show(atLane));

      const killedIter = await killAt(dir, ["--scenario", "graph", "--phase", "recover", "--stall", "iter"], "iter");
      assert.notEqual(killedIter, killedLane);
      const atIter = snap(dir);
      assert.deepEqual(stepsOf(atIter, lane.run_id, "lane").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(atIter));
      assert.deepEqual(patchSteps(atIter), ["work", "other", "lane"], show(atIter));
      const iter = atIter.links.find((row) => row.parent_run === parent.id && row.scope?.iterationKey === "a");
      assert.ok(iter, show(atIter));
      assert.deepEqual(stepsOf(atIter, iter.run_id, "iter").map((row) => [row.attempt, row.state]), [[1, "running"]], show(atIter));
      assert.equal(atIter.links.filter((row) => row.scope?.containerNodeId === "each").length, 1, show(atIter));

      const finishedBy = await runToExit(dir, ["--scenario", "graph", "--phase", "recover", "--again"]);
      assert.notEqual(finishedBy, killedIter);
      const done = snap(dir);
      assert.equal(parents(done)[0]?.status, "succeeded", show(done));
      assert.deepEqual(stepsOf(done, iter.run_id, "iter").map((row) => [row.attempt, row.state]), [[1, "succeeded"]], show(done));
      assert.deepEqual(patchSteps(done), ["work", "other", "lane", "iter"], show(done));
      assert.equal(done.links.filter((row) => row.parent_run === parent.id).length, 3, show(done));
      for (const step of ["work", "pause", "lane", "other", "iter"]) {
        const rows = done.steps.filter((row) => row.step === step);
        assert.equal(rows.length, 1, `${step} ${show(done)}`);
        assert.equal(rows[0]?.attempt, 1, show(done));
        assert.equal(rows[0]?.state, "succeeded", show(done));
      }
    });
  });
});
