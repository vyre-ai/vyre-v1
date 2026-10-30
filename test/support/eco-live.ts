// Shared pieces of the booted-daemon tests for skills, plugins and Kits (test/chat-ecosystem.live.test.ts): a seeded data directory, a daemon whose model vendor is a scripted session, capability
// calls over HTTP and a chat that waits for a reply. Nothing inside the daemon is faked: chat, agents, engine, the tool pipeline, the Gate, the Vault and the sandbox are live.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DriverEvent, EngineSession, OpenSession, ToolResult, TurnInput } from "../../agent/src/turn-engine/types.ts";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
export const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

export function seededDir(): string {
  const core = bootCore();
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-eco-live-")));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

export async function boot(dir: string, standIn: OpenSession, extra: Record<string, unknown> = {}): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "eco-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
    engineOpenSession: standIn,
    ...extra,
  } as Parameters<typeof startDaemon>[0]);
}

export async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
export async function ok(d: Daemon, cap: string, input: unknown): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, input);
  assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

export function hostLog(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 30 OR msg LIKE '%engine%' ORDER BY id DESC LIMIT 30").all() as Array<{ level: number; place: string | null; cap: string | null; msg: string; attrs: string | null }>;
  return JSON.stringify(rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`));
}

export async function waitFor<T>(f: () => Promise<T | null>, ms = 40_000, why?: () => string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`waitFor: it never happened${why ? `; host log ${why()}` : ""}`);
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}

/** The owner's Claude account, the way a person connects it. */
export async function connect(d: Daemon): Promise<string> {
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(unlock.status, 204, `unlock: ${unlock.status}`);
  const folder = await ok(d, "vault.folders.create", { idempotencyKey: "eco-folder", name: "Accounts", scope: "mine" });
  const flow = await ok(d, "providers.subscription_start", { idempotencyKey: "eco-flow", providerKey: "claude-code" });
  await ok(d, "vault.item.put", { idempotencyKey: "eco-item", folderId: folder.folder.id, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  const provider = await ok(d, "providers.subscription_complete", { flowId: flow.flowId });
  await ok(d, "providers.set_space_use", { idempotencyKey: "eco-spaceuse", providerId: provider.provider.id, allow: true });
  // the first engine call builds the runtime
  await ok(d, "engine.pool.status", {});
  return folder.folder.id as string;
}

export async function makeAgent(d: Daemon, name: string, role = "You answer intake questions."): Promise<string> {
  return (await ok(d, "agents.create", { name, role, idempotencyKey: `eco-agent-${name}` })).agent.agentId as string;
}

export async function lastAgentReply(d: Daemon, threadId: string, after = 0): Promise<string | null> {
  await d.hooks?.pump?.();
  const r = await call(d, "chat.messages.list", { threadId });
  const ms = (r.data.messages as Array<{ author?: { kind?: string }; body?: string; threadSeq?: number }> | undefined) ?? [];
  const m = ms.filter((x) => x.author?.kind === "agent" && (x.body ?? "") !== "" && (x.threadSeq ?? 0) > after).at(-1);
  return m?.body ?? null;
}

export async function startChat(d: Daemon, agentId: string, key: string): Promise<string> {
  return (await ok(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-start` })).thread.threadId as string;
}

/** Post in a thread and wait for the next agent reply. */
export async function post(d: Daemon, threadId: string, agentId: string, body: string, key: string): Promise<string> {
  const before = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ threadSeq?: number }> | undefined)?.length ?? 0;
  await ok(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post` });
  return waitFor(() => lastAgentReply(d, threadId, before), 60_000, () => hostLog(d));
}

/** Runs one tool through the engine's tool runner (the real pipeline: the agent acting for the asker) and returns what the tool answered. */
export type RunTool = (name: string, input: unknown) => AsyncGenerator<DriverEvent, ToolResult>;

/** A model vendor stand-in that decides like a model would: `plan` reads the turn input and yields text and tool calls. */
export function scriptedModel(plan: (input: TurnInput, run: RunTool) => AsyncGenerator<DriverEvent, void>): OpenSession {
  return async () => {
    const waiting = new Map<string, (r: ToolResult) => void>();
    let n = 0;
    const run: RunTool = async function* (name, input) {
      const id = `call_${++n}`;
      const answer = new Promise<ToolResult>((resolve) => waiting.set(id, resolve));
      yield { type: "tool_call", id, name, input };
      return answer;
    };
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> { yield* plan(input, run); yield { type: "done" }; },
      sendToolResult(id: string, r: ToolResult) { waiting.get(id)?.(r); waiting.delete(id); },
      inject() {}, async cancel() {}, async close() {},
    } as EngineSession;
  };
}

/** Stops the daemon, but never waits for it forever: a test that failed must still report why. */
export async function stop(d: Daemon): Promise<void> {
  await Promise.race([d.stop(), new Promise<void>((r) => setTimeout(r, 15_000).unref())]);
  const { closeDefaultSandbox } = await import("../../modules/engine/runtime.ts");
  await closeDefaultSandbox().catch(() => undefined);
}

/** A code root that is the real one, plus one more Kit in kits/ (the daemon reads shipped Kits from kits/<key>/kit.json). Every other file is a link to the real one. */
export function codeRootWithKit(kit: { key: string }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-eco-root-"));
  for (const name of fs.readdirSync(CODE_ROOT)) {
    if (name.startsWith(".") || name === "kits") continue;
    fs.symlinkSync(path.join(CODE_ROOT, name), path.join(root, name));
  }
  fs.mkdirSync(path.join(root, "kits"));
  for (const name of fs.readdirSync(path.join(CODE_ROOT, "kits"))) fs.symlinkSync(path.join(CODE_ROOT, "kits", name), path.join(root, "kits", name));
  fs.mkdirSync(path.join(root, "kits", kit.key));
  fs.writeFileSync(path.join(root, "kits", kit.key, "kit.json"), JSON.stringify(kit));
  return root;
}
