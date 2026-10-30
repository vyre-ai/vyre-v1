// The Run code runner and the way its result is read, without bubblewrap: the same script and the same Node flags run directly in a folder. This proves what the code sees and what comes back;
// that the kernel sandbox around it holds is proved by host/tests/automations.code.live.test.ts on a Linux runner with bubblewrap.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUNNER, guardedLookup, nodeFlags, readResult } from "../code-sandbox.ts";

const codeOf = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;

function run(source: string, input: unknown = {}, env: Record<string, string> = {}, heapMb = 96): { result?: unknown; logs?: string[]; error?: string; code?: string; stderr: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-code-runner-")));
  try {
    fs.writeFileSync(path.join(dir, "runner.mjs"), RUNNER);
    fs.writeFileSync(path.join(dir, "code.js"), source);
    fs.writeFileSync(path.join(dir, "input.json"), JSON.stringify(input));
    const p = spawnSync(process.execPath, [...nodeFlags(dir, heapMb), path.join(dir, "runner.mjs"), dir], { env, encoding: "utf8", timeout: 20_000 });
    const outcome = { code: p.status, signal: p.signal, stderr: p.stderr, timedOut: false };
    try {
      const r = readResult(dir, outcome, 10, heapMb);
      return { result: r.result, logs: r.logs, stderr: p.stderr };
    } catch (e) {
      return { error: (e as Error).message, code: codeOf(e), stderr: p.stderr };
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("the function body gets input and log, can await, and returns JSON", () => {
  const r = run("log('a', {b: 1}); const v = await Promise.resolve(input.n + 1); console.log('c'); return { v, again: input.list.map((x) => x * 2) };", { n: 2, list: [1, 2] });
  assert.deepEqual(r.result, { v: 3, again: [2, 4] });
  assert.deepEqual(r.logs, ["a {\"b\":1}", "c"]);
});

test("undefined becomes null and a function result is not JSON", () => {
  assert.equal(run("return undefined").result, null);
  const f = run("return () => 1");
  assert.equal(f.code, "validation.bad_input");
  assert.equal(run("throw new Error(JSON.stringify(input))", { secret: "s3cr3t" }).error?.includes("s3cr3t"), false, "the code's own words, which may hold its input, are not in the error");
});

test("a throw comes back as its message, a syntax error as a failure", () => {
  assert.deepEqual([run("throw new Error('nope')").code, run("throw new Error('nope')").error], ["validation.bad_input", "The code threw Error."]);
  assert.equal(run("return (").code, "validation.bad_input");
});

test("there is no fetch without a network, no process spawn, and no file outside the run folder", () => {
  assert.equal(run("return typeof fetch").result, "undefined");
  assert.equal(run("return typeof fetch", {}, { VYRE_CODE_NET: "1" }).result, "function");
  const spawn = run("const cp = await import('node:child_process'); try { cp.execSync('echo hi'); return 'spawned'; } catch (e) { return e.code; }");
  assert.equal(spawn.result, "ERR_ACCESS_DENIED");
  const read = run("const fs = await import('node:fs'); try { return fs.readFileSync('/etc/hosts', 'utf8').length > 0 ? 'read' : 'empty'; } catch (e) { return e.code; }");
  assert.equal(read.result, "ERR_ACCESS_DENIED");
  const write = run("const fs = await import('node:fs'); try { fs.writeFileSync('/tmp/vyre-code-escape', 'x'); return 'wrote'; } catch (e) { return e.code; }");
  assert.equal(write.result, "ERR_ACCESS_DENIED");
  assert.equal(run("return typeof process.env.VYRE_SECRET", {}, {}).result, "undefined");
});

test("an output over 1 MB is refused", () => {
  const r = run("return 'a'.repeat(1_000_100)");
  assert.equal(r.code, "validation.too_large");
  assert.match(r.error ?? "", /more than 1 MB/);
});

test("a log keeps 50 lines of 500 characters", () => {
  const r = run("for (let i = 0; i < 80; i++) log('x'.repeat(900)); return 1");
  assert.equal(r.logs?.length, 50);
  assert.equal(r.logs?.[0]?.length, 500);
});

test("an allocation failure outside the heap is reported as memory", () => {
  const r = run("throw new RangeError('Array buffer allocation failed')");
  assert.equal(r.code, "validation.bad_input");
  assert.match(r.error ?? "", /memory/);
});

test("a heap over the cap ends the process, and the step says it was memory", () => {
  const r = run("const a = []; for (;;) a.push(new Array(1_000_000).fill(1));", {}, {}, 32);
  assert.equal(r.code, "validation.bad_input");
  assert.match(r.error ?? "", /memory/);
});

test("how an ended process is told apart when it left no result", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-code-read-"));
  try {
    const none = { code: null, signal: null, stderr: "", timedOut: false };
    assert.throws(() => readResult(dir, { ...none, timedOut: true }, 10, 96), (e) => codeOf(e) === "timeout.deadline");
    assert.throws(() => readResult(dir, { ...none, signal: "SIGKILL" }, 10, 96), (e) => codeOf(e) === "timeout.deadline" && /10 seconds of processor time/.test((e as Error).message));
    assert.throws(() => readResult(dir, { ...none, code: 152 }, 10, 96), (e) => codeOf(e) === "timeout.deadline");
    assert.throws(() => readResult(dir, { ...none, stderr: "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" }, 10, 96), (e) => codeOf(e) === "validation.bad_input" && /96 MB/.test((e as Error).message));
    assert.throws(() => readResult(dir, { ...none, code: 1, stderr: "boom SECRET" }, 10, 96), (e) => codeOf(e) === "validation.bad_input" && /did not finish/.test((e as Error).message) && !/SECRET/.test((e as Error).message));
    fs.writeFileSync(path.join(dir, "result.json"), "x".repeat(1_100_000));
    assert.throws(() => readResult(dir, none, 10, 96), (e) => codeOf(e) === "validation.too_large");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a name that resolves to any address on the shared net-guard list is refused whole, including the newer ranges", async () => {
  const answer = (ips: string[]) => guardedLookup(async () => ips);
  for (const bad of ["100.64.0.1", "100.100.1.2", "198.18.0.1", "198.19.255.254", "224.0.0.1", "255.255.255.255", "::", "::1", "64:ff9b:1::1", "fe80::1", "fc00::1", "10.0.0.1", "169.254.169.254", "::ffff:127.0.0.1"]) {
    assert.deepEqual(await answer([bad])("x.example.com"), [], bad);
    assert.deepEqual(await answer(["93.184.216.34", bad])("x.example.com"), [], `${bad} next to a public address`);
  }
  assert.deepEqual(await answer(["93.184.216.34"])("x.example.com"), ["93.184.216.34"]);
});

test("a memory limit the code meets is one answer: the heap, a failed Buffer or ArrayBuffer allocation, and a typed array too large", () => {
  for (const source of [
    "throw Object.assign(new RangeError('Array buffer allocation failed'), { code: 'ERR_MEMORY_ALLOCATION_FAILED' })",
    "throw new RangeError('Array buffer allocation failed')",
    "throw new RangeError('Invalid typed array length: 4294967297')",
    "throw Object.assign(new RangeError('Cannot create a Buffer larger than 9007199254740991 bytes'), { code: 'ERR_BUFFER_TOO_LARGE' })",
    "throw new Error('FATAL: JavaScript heap out of memory')",
  ]) {
    const r = run(source);
    assert.equal(r.code, "validation.bad_input", source);
    assert.match(String(r.error), /used more than \d+ MB of memory/, source);
  }
  // another RangeError of the code's own stays a thrown error, named but not quoted
  assert.equal(run("throw new RangeError('toFixed() digits argument must be between 0 and 100')").error, "The code threw RangeError.");
});
