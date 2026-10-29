// Run code where the server has no sandbox: the step is hidden from the catalogue, kept in a draft, refused when the automation is turned on, and fails by name when it is run. The code is never run
// in the daemon. (The proofs on real bubblewrap are in automations.code.live.test.ts, a heavy test.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-code-off-")));
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
    ...(code ? { seams: { drivers: { setCodeHost: () => ({ dataDir: dir, ...code }) } } } : {}),
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
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
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
  return until("the run to end", 60_000, async () => {
    const run = (await ok(d, "runs.get", { runId })).run as { status: string };
    if (run.status !== "succeeded" && run.status !== "failed" && run.status !== "stopped") return undefined;
    const row = d.db!.all("SELECT state, output_json, error_code, error_message FROM runs_steps WHERE run_id = ? AND step = 'code'", runId)[0] as { state: string; output_json: string | null; error_code: string | null; error_message: string | null } | undefined;
    return { status: run.status, ...(row?.output_json ? { output: JSON.parse(row.output_json) } : {}), ...(row?.error_code ? { error: { code: row.error_code, message: row.error_message ?? "" } } : {}) };
  });
}

test("no sandbox on this server: Run code is hidden, saved in a draft, refused when turned on, and fails by name when it is run", async () => {
  const dir = seededDir();
  const d = await boot(dir, { unavailable: "Run code needs bubblewrap, and this test server has none." });
  try {
    const steps = (await ok(d, "automations.steps.list", {})).steps as Array<{ key: string }>;
    assert.equal(steps.some((s) => s.key === "code"), false, "the step stays hidden");
    assert.equal(steps.some((s) => s.key === "ai"), true);
    const made = await ok(d, "automations.create", { idempotencyKey: "code-off", name: "Code off", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "code", key: "code", input: { language: "javascript", source: "return 1" } }] } });
    const id = String(made.automation.id);
    assert.equal(made.automation.definition.nodes[0].key, "code", "a draft keeps the step");
    const on = await call(d, "automations.set_enabled", { automationId: id, enabled: true });
    assert.equal(on.status, 422, JSON.stringify(on.data));
    assert.match(JSON.stringify(on.data), /Run code cannot be turned on here\. Run code needs bubblewrap, and this test server has none\./);
    const ran = await runCode(d, { source: "return 1" });
    assert.equal(ran.status, "failed");
    assert.equal(ran.error?.code, "run.no_code");
    assert.match(String(ran.error?.message), /bubblewrap/);
    assert.equal(fs.existsSync(path.join(dir, "code")), false, "nothing ran, and nothing was written");
    const support = await ok(d, "steps.support", {});
    assert.deepEqual(support.code, { available: false, reason: "Run code needs bubblewrap, and this test server has none." });
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a Mac, or any server without bwrap, refuses with the platform reason and never falls back to running the code in the daemon", async () => {
  const dir = seededDir();
  const d = await boot(dir, { platform: "darwin" });
  try {
    const ran = await runCode(d, { source: "return process.pid" });
    assert.equal(ran.status, "failed");
    assert.equal(ran.error?.code, "run.no_code");
    assert.match(String(ran.error?.message), /Linux server with bubblewrap/);
    const lost = await boot(seededDir(), { platform: "linux", bwrapPaths: ["/nonexistent/bwrap"] }).then(async (d2) => { try { return await ok(d2, "steps.support", {}); } finally { await d2.stop(); } });
    assert.equal(lost.code.available, false);
    assert.match(lost.code.reason, /bubblewrap \(bwrap\) on the server/);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

