// Memory is live in chats on a booted daemon (spec 2.15): a fact a person states in chat 1 is captured when the chat closes (by the agent's captureMode), and chat 2 recalls it with its source.
// Nothing is faked inside the daemon: chat, agents, engine, bridge, memory and the hook runner are live. The model vendor stand-in is a scripted session that answers with the prompt a CLI engine
// is sent for the turn (agent/src/drivers/cli/prompt.ts), so what the engine put in front of the model is what the reply says. It needs no sandbox, so it runs on any machine.
import test from "node:test";
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-memory-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

const standIn: OpenSession = async () => ({
  warm: true,
  async *send(input: TurnInput): AsyncGenerator<DriverEvent> { yield { type: "text", text: defaultPrompt(input, true) }; yield { type: "done" }; },
  sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
} as EngineSession);

async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "memory-live", free: 80e9,
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
    // the model stand-in: the session says what a CLI engine would be sent for the turn
    engineOpenSession: standIn,
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

/** What the host logged at warn level or about the engine, so a reply that never comes says why. */
function hostLog(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 30 OR msg LIKE '%consumer%' OR msg LIKE '%bridge%' OR msg LIKE '%engine%' ORDER BY id DESC LIMIT 30").all() as Array<{ level: number; place: string | null; cap: string | null; msg: string; attrs: string | null }>;
  return JSON.stringify(rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`));
}

async function waitFor<T>(f: () => Promise<T | null>, ms = 40_000, why?: () => string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`waitFor: it never happened${why ? `; host log ${why()}` : ""}`);
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}


/** Her Claude account the way a person connects it, as in chat.live.test.ts. */
async function connect(d: Daemon): Promise<void> {
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(unlock.status, 204, `unlock: ${unlock.status}`);
  const folder = await call(d, "vault.folders.create", { idempotencyKey: "mem-folder", name: "Accounts", scope: "mine" });
  const flow = await call(d, "providers.subscription_start", { idempotencyKey: "mem-flow", providerKey: "claude-code" });
  const item = await call(d, "vault.item.put", { idempotencyKey: "mem-item", folderId: folder.data.folder.id, name: "Olivia_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  assert.equal(item.status, 200, JSON.stringify(item.data));
  const provider = await call(d, "providers.subscription_complete", { flowId: flow.data.flowId });
  assert.equal(provider.status, 200, JSON.stringify(provider.data));
  const allowed = await call(d, "providers.set_space_use", { idempotencyKey: "mem-spaceuse", providerId: provider.data.provider.id, allow: true });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
}

async function agent(d: Daemon, name: string, captureMode: string): Promise<string> {
  const made = await call(d, "agents.create", { name, role: "You answer intake questions.", idempotencyKey: `mem-agent-${name}` });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const id = made.data.agent.agentId as string;
  const set = await call(d, "agents.update", { agentId: id, patch: { captureMode }, idempotencyKey: `mem-mode-${name}` });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  return id;
}

/** Start a chat, say something to the agent and wait for its reply, which is the prompt the stand-in was given. */
async function say(d: Daemon, agentId: string, body: string, key: string): Promise<{ threadId: string; reply: string }> {
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

async function close(d: Daemon, threadId: string): Promise<void> {
  const r = await call(d, "threads.close", { threadId, idempotencyKey: `close-${threadId}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await d.hooks?.pump?.();
}

const facts = async (d: Daemon, agentId: string, status: string[]): Promise<Array<{ factId?: string; id?: string; text: string; status: string; sourceLink?: string }>> =>
  (await call(d, "memory.facts.list", { agentId, status, fromMe: true })).data.facts ?? [];

test("memory live: a fact stated in chat 1 is captured on close and recalled in chat 2 with its source; off captures nothing; propose waits for acceptance", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    await connect(d);
    const pool = await call(d, "engine.pool.status", {});
    assert.equal(pool.status, 200, JSON.stringify(pool.data));
    const keeper = await agent(d, "Keeper", "auto_low_risk");
    const silent = await agent(d, "Silent", "off");
    const asker = await agent(d, "Asker", "propose");

    // chat 1 with the agent that merges low-risk facts: the fact is captured when the chat closes
    const first = await say(d, keeper, "I prefer purple folders for client invoices.", "keep1");
    assert.doesNotMatch(first.reply, /From memory/, "nothing is recalled before anything is known");
    await close(d, first.threadId);
    const kept = await waitFor(async () => { await d.hooks?.pump?.(); const f = await facts(d, keeper, ["current"]); return f.length > 0 ? f : null; }, 20_000, () => hostLog(d));
    assert.ok(kept.some((f) => f.text.includes("purple folders") && f.sourceLink === `/chats/${first.threadId}`), JSON.stringify(kept));

    // chat 2 recalls it, and says where it came from
    const second = await say(d, keeper, "which folders do I prefer for client invoices?", "keep2");
    assert.match(second.reply, /From memory/);
    assert.match(second.reply, /purple folders/);
    assert.ok(second.reply.includes(`source: /chats/${first.threadId}`), `the source is named: ${second.reply}`);

    // an agent whose capture is off keeps nothing, however plain the preference
    const quiet = await say(d, silent, "I prefer green binders for client invoices.", "off1");
    await close(d, quiet.threadId);
    await d.hooks?.pump?.();
    assert.deepEqual(await facts(d, silent, ["current", "proposed"]), [], "off means nothing is captured");

    // an agent that proposes leaves the fact waiting; accepting it makes it known, rejecting another leaves it unknown
    const proposing = await say(d, asker, "I prefer blue pens for client invoices. I never use red ink for client invoices.", "prop1");
    await close(d, proposing.threadId);
    const waiting = await waitFor(async () => { await d.hooks?.pump?.(); const f = await facts(d, asker, ["proposed"]); return f.length >= 2 ? f : null; }, 20_000, () => hostLog(d));
    assert.equal((await facts(d, asker, ["current"])).length, 0, "nothing merged on its own");
    const pens = waiting.find((f) => f.text.includes("blue pens"))!;
    const red = waiting.find((f) => f.text.includes("red ink"))!;
    const idOf = (f: { factId?: string; id?: string }): string => (f.factId ?? f.id) as string;
    assert.equal((await call(d, "memory.fact.accept", { factId: idOf(pens) })).status, 200);
    assert.equal((await call(d, "memory.fact.reject", { factId: idOf(red) })).status, 200);
    const recalled = await say(d, asker, "what pens do I prefer for client invoices?", "prop2");
    assert.match(recalled.reply, /blue pens/);
    const rejected = await say(d, asker, "which ink do I never use for client invoices?", "prop3");
    assert.doesNotMatch(rejected.reply, /\[fct_[a-z0-9]+\][^\n]*red ink/, "a rejected fact is not recalled as a fact (the words people wrote stay findable as quotes)");
  } finally { await d.stop(); }
});
