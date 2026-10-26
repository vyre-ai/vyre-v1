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
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

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
    // her Claude account, the way a person connects it (spec 6.4): her client unlocks her person key on this node, the sign-in starts, her client saves the token as a Mine item, Done links it as her provider, and
    // she lets the Space use it (a private chat with no desktop device online runs on the Space, spec 6.3)
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204, `unlock: ${unlock.status}`);
    const folder = await call(d, "vault.folders.create", { idempotencyKey: "chat-live-folder", name: "Accounts", scope: "mine" });
    assert.equal(folder.status, 200, JSON.stringify(folder.data));
    const flow = await call(d, "providers.subscription_start", { idempotencyKey: "chat-live-flow", providerKey: "claude-code" });
    assert.equal(flow.status, 200, JSON.stringify(flow.data));
    const item = await call(d, "vault.item.put", { idempotencyKey: "chat-live-item", folderId: folder.data.folder.id, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
    assert.equal(item.status, 200, JSON.stringify(item.data));
    const provider = await call(d, "providers.subscription_complete", { flowId: flow.data.flowId });
    assert.equal(provider.status, 200, JSON.stringify(provider.data));
    const allowed = await call(d, "providers.set_space_use", { idempotencyKey: "chat-live-spaceuse", providerId: provider.data.provider.id, allow: true });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
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
