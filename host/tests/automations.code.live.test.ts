// @heavy docker
// The Run code step on a booted host. The sandbox proofs run on real bubblewrap (the l2-heavy job, VYRE_HEAVY_DOCKER=1; with it on, a missing bwrap fails instead of skipping): the code gets its input and
// returns JSON, has no network and no files of the host, reaches only the hosts the step names, and is stopped at its limits. The unavailable path (no sandbox on the server) runs everywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import http from "node:http";
import net from "node:net";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the code runs in real bubblewrap)";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-code-live-")));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

type CodeHostOpts = Record<string, unknown>;
async function boot(dir: string, code: CodeHostOpts | null): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "code-live", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    ...(code ? { seams: { drivers: { setCodeHost: () => ({ dataDir: dir, diagnose: true, ...code }) } } } : {}),
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
async function ok(d: Daemon, cap: string, input: unknown): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, input);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function until<T>(what: string | (() => string), ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${typeof what === "function" ? what() : what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

let n = 0;
const seenByStub: string[] = [];
interface Done { status: string; output?: any; error?: { code?: string; message?: string } }   // eslint-disable-line @typescript-eslint/no-explicit-any
/** One Automation with one Run code step, run to its end. */
async function runCode(d: Daemon, input: Record<string, unknown>, mode: "run" | "test" = "run"): Promise<Done> {
  n += 1;
  const made = await ok(d, "automations.create", { idempotencyKey: `code-${n}`, name: `Code ${n}`, definition: { triggers: [{ key: "manual" }], nodes: [{ id: "code", key: "code", input: { language: "javascript", ...input } }] } });
  const id = String(made.automation.id);
  const started = await ok(d, mode === "test" ? "automations.test" : "automations.run", mode === "test" ? { automationId: id } : { automationId: id, idempotencyKey: `code-run-${n}` });
  const runId = String(started.runId);
  let last = "";
  return until(() => `the run to end (${last})`, 60_000, async () => {
    const run = (await ok(d, "runs.get", { runId })).run as { status: string };
    const step = d.db!.all("SELECT state, error_code, error_message FROM runs_steps WHERE run_id = ? AND step = 'code'", runId)[0];
    last = `run ${run.status}, step ${JSON.stringify(step ?? null)}`;
    if (run.status !== "succeeded" && run.status !== "failed" && run.status !== "stopped") return undefined;
    const row = d.db!.all("SELECT state, output_json, error_code, error_message FROM runs_steps WHERE run_id = ? AND step = 'code'", runId)[0] as { state: string; output_json: string | null; error_code: string | null; error_message: string | null } | undefined;
    return { status: run.status, ...(row?.output_json ? { output: JSON.parse(row.output_json) } : {}), ...(row?.error_code ? { error: { code: row.error_code, message: row.error_message ?? "" } } : {}) };
  });
}

test("real bubblewrap: input in, JSON out, no network, no host files, only the named hosts, and the limits hold", { skip }, async () => {
  assert.equal(spawnSync("bwrap", ["--version"]).status, 0, "bwrap is not installed");
  process.env["DAEMON_ONLY_SECRET"] = "daemon-secret-7731";
  const dir = seededDir();
  const d = await boot(dir, { cpuSeconds: 2, wallMs: 12_000, heapMb: 64 });
  try {
    assert.deepEqual((await ok(d, "steps.support", {})).code, { available: true }, "this runner can sandbox it");
    const steps = (await ok(d, "automations.steps.list", {})).steps as Array<{ key: string }>;
    assert.equal(steps.some((s) => s.key === "code"), true, "the step is offered where it can run");

    // input in, JSON out, logs kept, and the step can be turned on
    const sum = await runCode(d, { source: "log('adding'); const t = await Promise.resolve(input.a + input.b); return { t, list: input.list.map((x) => x * 2) };", input: { a: 2, b: 3, list: [1, 2] } });
    assert.equal(sum.status, "succeeded", JSON.stringify(sum));
    assert.deepEqual(sum.output, { result: { t: 5, list: [2, 4] }, logs: ["adding"] });
    const made = await ok(d, "automations.create", { idempotencyKey: "code-on", name: "On", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "code", key: "code", input: { source: "return 1" } }] } });
    assert.equal((await ok(d, "automations.set_enabled", { automationId: made.automation.id, enabled: true })).automation.status, "on");

    // a sandbox test runs it for real (code only reads)
    const tested = await runCode(d, { source: "return 6 * 7" }, "test");
    assert.deepEqual(tested.output, { result: 42, logs: [] });

    // no network at all: no fetch, and a raw socket has nowhere to go
    const offline = await runCode(d, { source: "const net = await import('node:net'); const raw = await new Promise((r) => { const s = net.connect({ host: '93.184.216.34', port: 443 }); s.on('error', (e) => r('blocked:' + e.code)); s.on('connect', () => r('CONNECTED')); setTimeout(() => r('blocked:timeout'), 4000); }); return { fetch: typeof fetch, raw };" });
    assert.equal(offline.status, "succeeded", JSON.stringify(offline));
    assert.equal(offline.output.result.fetch, "undefined");
    assert.match(offline.output.result.raw, /^blocked:/);

    // a named host is reached through the proxy: the stand-in internet resolves api.example.test to a public address and dials the local stub, and a name that resolves inside is refused
    const stub = http.createServer((req, res) => { seenByStub.push(`${req.method} ${req.url} host=${req.headers.host}`); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ hello: "from the stub" })); });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
    const stubPort = (stub.address() as net.AddressInfo).port;
    const worldwide = await boot(seededDir(), {
      cpuSeconds: 5, wallMs: 20_000,
      egress: {
        lookup: async (host: string) => (host === "inside.example.test" ? ["10.1.2.3"] : ["93.184.216.34"]),
        connect: (_h: string, _p: number, ip: string) => (ip === "10.1.2.3" ? Promise.reject(new Error("must never be dialled")) : new Promise((resolve, reject) => { const s = net.connect({ host: "127.0.0.1", port: stubPort }); s.once("connect", () => resolve(s)); s.once("error", reject); })),
      },
    });
    try {
      const reached = await runCode(worldwide, {
        hosts: ["api.example.test", "inside.example.test"],
        source: "const out = {}; const r = await fetch('http://api.example.test/hello?x=1'); out.reached = await r.json(); try { await fetch('http://inside.example.test/'); out.inside = 'REACHED'; } catch (e) { out.inside = 'blocked'; } try { await fetch('http://other.example.test/'); out.other = 'REACHED'; } catch (e) { out.other = 'blocked'; } return out;",
      });
      assert.equal(reached.status, "succeeded", JSON.stringify(reached));
      assert.deepEqual(reached.output.result, { reached: { hello: "from the stub" }, inside: "blocked", other: "blocked" });
      assert.deepEqual(seenByStub, ["GET /hello?x=1 host=api.example.test"], "only the named host was dialled, once");
    } finally { await worldwide.stop(); stub.close(); stub.closeAllConnections(); }

    // a named host is reachable through the proxy and nothing else is: another name, an address, and a private address are refused by the proxy
    const walled = await runCode(d, {
      hosts: ["example.com"],
      source: "const tries = {}; for (const url of ['https://example.org/', 'https://93.184.216.34/', 'https://127.0.0.1/', 'http://169.254.169.254/latest/meta-data']) { try { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); tries[url] = 'status ' + r.status; } catch (e) { tries[url] = 'blocked'; } } return { hasFetch: typeof fetch, tries };",
    });
    assert.equal(walled.status, "succeeded", JSON.stringify(walled));
    assert.equal(walled.output.result.hasFetch, "function");
    for (const [url, how] of Object.entries(walled.output.result.tries as Record<string, string>)) assert.equal(how, "blocked", `${url} was reachable`);

    // no host files, no daemon environment, no process to start, no write outside its folder
    const caged = await runCode(d, {
      source: "const fs = await import('node:fs'); const cp = await import('node:child_process'); const out = {}; const t = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = e.code || e.message; } }; t('passwd', () => fs.readFileSync('/etc/passwd', 'utf8').length); t('proc', () => fs.readFileSync('/proc/self/environ', 'utf8').length); t('home', () => fs.readdirSync('/home').length); t('write', () => fs.writeFileSync('/tmp/escape.txt', 'x')); t('spawn', () => cp.execSync('echo hi').toString()); out.env = Object.keys(process.env); out.secret = process.env.DAEMON_ONLY_SECRET ?? null; return out;",
    });
    assert.equal(caged.status, "succeeded", JSON.stringify(caged));
    const r = caged.output.result as Record<string, unknown>;
    for (const k of ["passwd", "proc", "write", "spawn"]) assert.equal(r[k], "ERR_ACCESS_DENIED", `${k}: ${String(r[k])}`);
    assert.equal(r["secret"], null);
    assert.equal(JSON.stringify(r["env"]).includes("daemon-secret"), false);
    assert.equal(fs.existsSync("/tmp/escape.txt"), false);

    // limits: processor time, wall clock, memory and output size
    const spin = await runCode(d, { source: "while (true) {}" });
    assert.equal(spin.status, "failed");
    assert.equal(spin.error?.code, "timeout.deadline", JSON.stringify(spin));
    assert.match(String(spin.error?.message), /processor time/);
    const sleepy = await runCode(d, { source: "await new Promise((r) => setTimeout(r, 60000)); return 1;" });
    assert.equal(sleepy.error?.code, "timeout.deadline", JSON.stringify(sleepy));
    const heavy = await runCode(d, { source: "const a = []; for (;;) a.push(new Array(1000000).fill(1));" });
    assert.equal(heavy.status, "failed");
    assert.match(String(heavy.error?.message), /memory/, JSON.stringify(heavy));
    // Buffers and ArrayBuffers live outside the V8 heap: the kernel's data limit stops them
    const buffers = await runCode(d, { source: "const keep = []; for (;;) keep.push(Buffer.alloc(50 * 1024 * 1024, 1));" });
    assert.equal(buffers.status, "failed");
    assert.match(String(buffers.error?.message), /memory|did not finish/, JSON.stringify(buffers));
    const big = await runCode(d, { source: "return 'a'.repeat(1100000)" });
    assert.equal(big.status, "failed");
    assert.match(String(big.error?.message), /more than 1 MB/);

    // the code's own failure comes back in its words
    const threw = await runCode(d, { source: "throw new Error('nope, not today')" });
    assert.equal(threw.error?.code, "validation.bad_input");
    assert.equal(threw.error?.message, "The code threw Error.", "the code's own words are not passed on");

    // nothing is left behind
    assert.deepEqual(fs.readdirSync(path.join(dir, "code")), [], "every run folder is removed");
  } finally { delete process.env["DAEMON_ONLY_SECRET"]; await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
