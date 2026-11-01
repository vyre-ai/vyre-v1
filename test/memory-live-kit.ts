// Helpers shared by the memory live tests: a seeded Space, a booted daemon with the scripted model vendor stand-in, a connected Claude account, agents and chats.
// The stand-in answers with the prompt the engine sent, and when a message says `TOOL <name> <json>` it calls that tool the way a model would and reports the result.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultPrompt } from "../agent/src/drivers/cli/prompt.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";
import { bootCore } from "../fixtures/seed/core/index.ts";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

export const DAY = 86_400_000;
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
export const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

export function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-memcore-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
export const clock = { t: Date.now() };

/** The model stand-in. A message `TOOL <name> <json>` becomes a tool call; the reply is the tool's result. Anything else is answered with the engine's prompt. */
export const standIn: OpenSession = async () => {
  const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
  return {
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const body = String(input.trigger?.body ?? "");
      const m = /TOOL (\w+) (\{.*\})/.exec(body);
      if (!m && body.startsWith("Tasks:")) {
        // an upkeep request: answer like a model would, with one pattern fact drawn from the first fact listed, and report the tokens
        const first = /^- (fct_[a-z0-9]+) /m.exec(body)?.[1];
        yield { type: "text", text: JSON.stringify({ actions: first ? [{ type: "create", text: "Pattern noticed by the stand-in", kind: "pattern", from: [first], reason: "seen more than once" }] : [] }) };
        yield { type: "usage", inputTokens: 1_200, outputTokens: 80 };
        yield { type: "done" };
        return;
      }
      if (!m) { yield { type: "text", text: defaultPrompt(input, true) }; yield { type: "done" }; return; }
      // a tool outside the default set is found with tool_search before it can be called, as a model must do
      const first = `call_${waiting.size + 1}`;
      const found = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set(first, resolve));
      yield { type: "tool_call", id: first, name: "tool_search", input: { query: m[1]! } };
      await found;
      const id = `call_${waiting.size + 1}`;
      const result = new Promise<{ ok: boolean; content: unknown }>((resolve) => waiting.set(id, resolve));
      yield { type: "tool_call", id, name: m[1]!, input: JSON.parse(m[2]!) };
      const r = await result;
      yield { type: "text", text: `TOOL RESULT ${r.ok ? "ok" : "failed"} ${JSON.stringify(r.content)}` };
      yield { type: "done" };
    },
    sendToolResult(callId: string, result: { ok: boolean; content: unknown }) { waiting.get(callId)?.(result); },
    inject() {}, async cancel() {}, async close() {},
  } as EngineSession;
};

/** `http` is the network under ctx.http (a provider's own API): tests answer it; omitted, it is the real network. */
export async function boot(dir: string, openSession: OpenSession = standIn, http?: Parameters<typeof startDaemon>[0]["http"]): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    now: () => clock.t,
    platform: fakePlatform({
      os: "linux", hostname: "memory-core-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    ...(http ? { http } : {}),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
    engineOpenSession: openSession,
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
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}

export async function connect(d: Daemon): Promise<void> {
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(unlock.status, 204, `unlock: ${unlock.status}`);
  const folder = await call(d, "vault.folders.create", { idempotencyKey: "mc-folder", name: "Accounts", scope: "mine" });
  const flow = await call(d, "providers.subscription_start", { idempotencyKey: "mc-flow", providerKey: "claude-code" });
  const item = await call(d, "vault.item.put", { idempotencyKey: "mc-item", folderId: folder.data.folder.id, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  assert.equal(item.status, 200, JSON.stringify(item.data));
  const provider = await call(d, "providers.subscription_complete", { flowId: flow.data.flowId });
  assert.equal(provider.status, 200, JSON.stringify(provider.data));
  const allowed = await call(d, "providers.set_space_use", { idempotencyKey: "mc-spaceuse", providerId: provider.data.provider.id, allow: true });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
}

/** An agent as a person makes it: no memory settings at all, so whatever the default capture mode is applies. */
export async function newAgent(d: Daemon, name: string): Promise<{ id: string; captureMode: string }> {
  const made = await call(d, "agents.create", { name, role: "You answer intake questions.", idempotencyKey: `mc-agent-${name}` });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  return { id: made.data.agent.agentId as string, captureMode: made.data.agent.captureMode as string };
}

export async function say(d: Daemon, agentId: string, body: string, key: string): Promise<{ threadId: string; reply: string }> {
  const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-start` });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const threadId = started.data.thread.threadId as string;
  const posted = await call(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post` });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  const reply = await waitFor(async () => {
    await d.hooks?.pump?.();
    const r = await call(d, "chat.messages.list", { threadId });
    const m = (r.data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
    return m?.body ?? null;
  }, 40_000, () => hostLog(d));
  return { threadId, reply };
}

export async function close(d: Daemon, threadId: string): Promise<void> {
  const r = await call(d, "threads.close", { threadId, idempotencyKey: `close-${threadId}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await d.hooks?.pump?.();
}

