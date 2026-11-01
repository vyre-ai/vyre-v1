// Shared pieces of the booted-daemon chat tests (test/chat-brain.live.test.ts): a seeded data directory, a daemon with a model stand-in, capability calls over HTTP, and a chat that waits for a reply.
// Nothing inside the daemon is faked. The model vendor stand-in is an OpenSession the test supplies.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenSession } from "../../agent/src/turn-engine/types.ts";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

export const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

export function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-chat-brain-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** `standIn` null with `engineCli` boots the real driver around a CLI process (the fake claude of host/tests/fixtures/fake-cli-driver). */
export async function boot(dir: string, standIn: OpenSession | null, extra: { engineCli?: unknown } = {}): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "chat-brain", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
    ...(standIn ? { engineOpenSession: standIn } : {}),
    ...(extra.engineCli !== undefined ? { engineCli: extra.engineCli as never } : {}),
  });
}

export async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

export function hostLog(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 30 OR msg LIKE '%consumer%' OR msg LIKE '%bridge%' OR msg LIKE '%engine%' ORDER BY id DESC LIMIT 30").all() as Array<{ level: number; place: string | null; cap: string | null; msg: string; attrs: string | null }>;
  return JSON.stringify(rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`));
}

export async function waitFor<T>(f: () => Promise<T | null>, ms = 40_000, why?: () => string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`waitFor: it never happened${why ? `; host log ${why()}` : ""}`);
    await new Promise<void>((r) => setTimeout(r, 30));
  }
}

/** Her Claude account the way a person connects it. */
export async function connect(d: Daemon): Promise<void> {
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(unlock.status, 204, `unlock: ${unlock.status}`);
  const folder = await call(d, "vault.folders.create", { idempotencyKey: "cb-folder", name: "Accounts", scope: "mine" });
  const flow = await call(d, "providers.subscription_start", { idempotencyKey: "cb-flow", providerKey: "claude-code" });
  const item = await call(d, "vault.item.put", { idempotencyKey: "cb-item", folderId: folder.data.folder.id, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  assert.equal(item.status, 200, JSON.stringify(item.data));
  const provider = await call(d, "providers.subscription_complete", { flowId: flow.data.flowId });
  assert.equal(provider.status, 200, JSON.stringify(provider.data));
  const allowed = await call(d, "providers.set_space_use", { idempotencyKey: "cb-spaceuse", providerId: provider.data.provider.id, allow: true });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
  // the first engine call builds the runtime
  const pool = await call(d, "engine.pool.status", {});
  assert.equal(pool.status, 200, JSON.stringify(pool.data));
}

export async function makeAgent(d: Daemon, name: string, role = "You answer intake questions.", patch: Record<string, unknown> = {}): Promise<string> {
  const made = await call(d, "agents.create", { name, role, idempotencyKey: `cb-agent-${name}` });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const id = made.data.agent.agentId as string;
  if (Object.keys(patch).length > 0) {
    const set = await call(d, "agents.update", { agentId: id, patch, idempotencyKey: `cb-patch-${name}` });
    assert.equal(set.status, 200, JSON.stringify(set.data));
  }
  return id;
}

export async function lastAgentReply(d: Daemon, threadId: string, after = 0): Promise<string | null> {
  await d.hooks?.pump?.();
  const r = await call(d, "chat.messages.list", { threadId });
  const ms = (r.data.messages as Array<{ author?: { kind?: string }; body?: string; threadSeq?: number }> | undefined) ?? [];
  const m = ms.filter((x) => x.author?.kind === "agent" && (x.body ?? "") !== "" && (x.threadSeq ?? 0) > after).at(-1);
  return m?.body ?? null;
}

/** The newest agent message after `after`, whether it has words or only a block (a question waits for an answer and has no words). */
export async function lastAgentMessage(d: Daemon, threadId: string, after = 0): Promise<string | null> {
  await d.hooks?.pump?.();
  const r = await call(d, "chat.messages.list", { threadId });
  const ms = (r.data.messages as Array<{ author?: { kind?: string }; body?: string; blocks?: Array<{ type: string }>; threadSeq?: number }> | undefined) ?? [];
  const m = ms.filter((x) => x.author?.kind === "agent" && ((x.body ?? "") !== "" || (x.blocks ?? []).length > 0) && (x.threadSeq ?? 0) > after).at(-1);
  return m ? (m.body && m.body !== "" ? m.body : `[${(m.blocks ?? []).map((b) => b.type).join(", ")}]`) : null;
}

/** Start a chat with the agent, say something and wait for its reply. */
export async function say(d: Daemon, agentId: string, body: string, key: string): Promise<{ threadId: string; reply: string }> {
  const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-start` });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const threadId = started.data.thread.threadId as string;
  const reply = await post(d, threadId, agentId, body, key);
  return { threadId, reply };
}

/** Like `say`, in a chat set to Auto: for a test that is about what an agent does with a change (a record, a routine, a setting). A new chat asks first before such a change, which the test would otherwise wait on. */
export async function sayAuto(d: Daemon, agentId: string, body: string, key: string): Promise<{ threadId: string; reply: string }> {
  const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-start` });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const threadId = started.data.thread.threadId as string;
  await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: `${key}-auto` });
  return { threadId, reply: await post(d, threadId, agentId, body, key) };
}

/** Post in a thread and wait for the next agent reply. */
export async function post(d: Daemon, threadId: string, agentId: string, body: string, key: string, extra: Record<string, unknown> = {}): Promise<string> {
  const before = ((await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ threadSeq?: number }> | undefined)?.length ?? 0;
  const posted = await call(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post`, ...extra });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  return waitFor(() => lastAgentReply(d, threadId, before), 40_000, () => hostLog(d));
}

// ---- a model that calls tools

import type { DriverEvent, EngineSession, ToolResult, TurnInput } from "../../agent/src/turn-engine/types.ts";

/** Runs one tool through the engine's tool runner (the real pipeline: the agent acting for the asker) and returns what the tool answered. */
export type RunTool = (name: string, input: unknown) => AsyncGenerator<DriverEvent, ToolResult>;

/**
 * A model vendor stand-in that decides like a model would: `plan` reads the turn input and yields text and tool calls. `yield* run(name, input)` makes a tool call and returns its result.
 * The tool runs for real, as the agent acting for the asker, through the invoke pipeline.
 */
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
