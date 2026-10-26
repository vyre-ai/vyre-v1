// @heavy docker
// The core proof for agents on a booted daemon (P-L2_LIVE, golden flow 7's engine half): a person's message to an agent over HTTP gets a streamed reply in the real chat thread. Nothing is faked
// inside the daemon: chat, agents, engine and the bridge are live; the Vault module still answers from its stub (its example provider is a Claude Code subscription), the secret comes from the
// daemon's Vault port, and the CLI is the fake CLI of host/tests/fixtures/fake-cli-driver run in the platform's default sandbox (bubblewrap with the network wall on the Linux runner).
// Runs only with VYRE_HEAVY_DOCKER=1 (the l2-heavy job).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-chat-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)";
const FAKE_CLI = fileURLToPath(new URL("./fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ";

async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "chat-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    // the Vault value behind the account the Vault module's example names; the access check is vault.use through the pipeline
    vault: { secret: async () => KEY, signRs256: async () => "" },
    // the real CLI is swapped for the fake one, which the sandbox is given read-only; the sandbox is the platform's default (bwrap with the network wall on Linux)
    engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] },
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

async function waitFor<T>(f: () => Promise<T | null>, ms = 40_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error("waitFor: it never happened");
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}

test("chat live: a person's message to an agent on a booted daemon gets a streamed reply in the same thread, from a CLI running in the sandbox", { skip }, async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    assert.deepEqual(d.seams?.missing, [], "no live module is left without its driver");
    // STOPGAP, remove when #472 (files live) lands: the Files module is still a stub, so the Agents folder cannot be found by search. Name one for the agents module with the daemon's own
    // modules.db handle; its file steps are answered by the stub. After #472, merge main, delete these two lines and the test goes through the real Agents folder.
    d.db!.run("CREATE TABLE IF NOT EXISTS agents_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    d.db!.run("INSERT OR REPLACE INTO agents_meta (key, value) VALUES (?, ?)", "agents.root", "fld_a1b2c3");
    const made = await call(d, "agents.create", { name: "Intake", role: "You answer intake questions.", idempotencyKey: "chat-live-agent" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const agentId = made.data.agent.agentId as string;
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "chat-live-start" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const threadId = started.data.thread.threadId as string;
    // the first engine call builds and binds the runtime, so the bridge consumer has an engine to hand the message to
    const pool = await call(d, "engine.pool.status", {});
    assert.equal(pool.status, 200, JSON.stringify(pool.data));
    const posted = await call(d, "chat.post", { threadId, body: "hello", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "chat-live-post" });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    // the consumer runs on the hook interval; force a pass the way the daemon's own timer does
    await d.hooks?.pump?.();
    const reply = await waitFor(async () => {
      await d.hooks?.pump?.();
      const r = await call(d, "chat.messages.list", { threadId });
      const m = (r.data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "").includes("Hello from the fake engine."));
      return m ?? null;
    });
    assert.ok(reply, "the agent's reply is in the thread the person wrote in");
  } finally { await d.stop(); }
});
