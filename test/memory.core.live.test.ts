// Memory core on a booted daemon (owner design 30 Oct 2026): capture is auto by default and shows in the Learned feed with Undo; a Space can require review; delete goes to Trash and restores for a person
// and for an agent; untouched Trash moves to Archive after the Space period and an admin restores it; an erase leaves a contentless trail line.
// Chat, agents, engine, bridge, memory and the hook runner are live. The model vendor stand-in is a scripted session: it answers with the prompt the engine sent, and when the message says
// `TOOL <name> <json>` it calls that tool the way a model would and reports the result, so an agent's own use of a memory tool goes through the real tool path.
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
const DAY = 86_400_000;

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-memcore-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const clock = { t: Date.now() };

/** The model stand-in. A message `TOOL <name> <json>` becomes a tool call; the reply is the tool's result. Anything else is answered with the engine's prompt. */
const standIn: OpenSession = async () => {
  const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
  return {
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const body = String(input.trigger?.body ?? "");
      const m = /TOOL (\w+) (\{.*\})/.exec(body);
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

async function boot(dir: string): Promise<Daemon> {
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
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
    engineOpenSession: standIn,
  });
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

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

async function connect(d: Daemon): Promise<void> {
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
async function newAgent(d: Daemon, name: string): Promise<{ id: string; captureMode: string }> {
  const made = await call(d, "agents.create", { name, role: "You answer intake questions.", idempotencyKey: `mc-agent-${name}` });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  return { id: made.data.agent.agentId as string, captureMode: made.data.agent.captureMode as string };
}

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

type Fact = { factId: string; text: string; status: string; sourceLink?: string; trashReason?: string };
const current = async (d: Daemon, agentId: string): Promise<Fact[]> => (await call(d, "memory.facts.list", { agentId, status: ["current"], fromMe: true })).data.facts ?? [];

test("memory core live: auto capture, Learned feed and Undo, Trash and restore (person and agent), Archive after the period, erase trail", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const keeper = await newAgent(d, "Keeper");
    assert.equal(keeper.captureMode, "auto", "a new agent learns on its own by default");

    // chat 1: a preference and a note, neither of which the old low-risk rule would have saved alone
    const first = await say(d, keeper.id, "I prefer purple folders for client invoices. Remember that rent is due on the first.", "k1");
    await close(d, first.threadId);
    const saved = await waitFor(async () => { await d.hooks?.pump?.(); const f = await current(d, keeper.id); return f.length >= 2 ? f : null; }, 20_000, () => hostLog(d));
    assert.ok(saved.some((f) => f.text.includes("purple folders")) && saved.some((f) => f.text.includes("rent is due")), JSON.stringify(saved));

    // the Learned feed: each with its source and who learned it
    const feed = (await call(d, "memory.learned", {})).data;
    assert.ok(feed.items.length >= 2, JSON.stringify(feed));
    const purple = feed.items.find((i: { fact: Fact }) => i.fact.text.includes("purple folders"));
    assert.equal(purple.actor, keeper.id);
    assert.equal(purple.actorKind, "agent");
    assert.equal(purple.sourceKind, "chat");
    assert.equal(purple.sourceLink, `/chats/${first.threadId}`);
    assert.equal(purple.undone, false);

    // Undo: out of recall, still in the feed as undone, found in Trash, and restore brings it back
    const undone = await call(d, "memory.undo", { factId: purple.fact.factId });
    assert.equal(undone.status, 200, JSON.stringify(undone.data));
    assert.equal(undone.data.trashed, true);
    const gone = await say(d, keeper.id, "which folders do I prefer for client invoices?", "k2");
    assert.doesNotMatch(gone.reply, /purple folders/, "an undone fact is not recalled");
    assert.equal((await call(d, "memory.trash.search", { q: "purple folders" })).data.facts[0]?.trashReason, "undone");
    assert.equal((await call(d, "memory.restore", { factId: purple.fact.factId })).status, 200);
    const back = await say(d, keeper.id, "which folders do I prefer for client invoices?", "k3");
    assert.match(back.reply, /purple folders/, "restored, it is recalled again");

    // delete the rent fact; an agent restores it through the tool, as itself
    const rent = saved.find((f) => f.text.includes("rent is due"))!;
    assert.equal((await call(d, "memory.facts.remove", { factIds: [rent.factId] })).data.removed, 1);
    assert.equal((await current(d, keeper.id)).some((f) => f.factId === rent.factId), false);
    const viaAgent = await say(d, keeper.id, `TOOL memory_restore ${JSON.stringify({ factId: rent.factId, idempotencyKey: "rs1" })}`, "k4");
    assert.match(viaAgent.reply, /TOOL RESULT ok/, viaAgent.reply);
    assert.equal((await current(d, keeper.id)).some((f) => f.factId === rent.factId), true, "the agent put it back");
    const trailRows = (await call(d, "memory.trail", { factId: rent.factId })).data.rows as Array<{ action: string; actorKind: string; actor: string }>;
    const restoreLine = trailRows.find((r) => r.action === "restore")!;
    assert.deepEqual([restoreLine.actorKind, restoreLine.actor], ["agent", keeper.id], JSON.stringify(trailRows));

    // delete again; 59 days later nothing moves; reading it starts the days again; 120 days on it is in Archive
    await call(d, "memory.facts.remove", { factIds: [rent.factId] });
    clock.t += 59 * DAY;
    assert.equal((await call(d, "memory.archive_sweep", {})).data.archived, 0);
    await call(d, "memory.fact.get", { factId: rent.factId });
    clock.t += 2 * DAY;
    assert.equal((await call(d, "memory.archive_sweep", {})).data.archived, 0, "touched at day 59");
    clock.t += 59 * DAY;
    assert.equal((await call(d, "memory.archive_sweep", {})).data.archived, 1);
    assert.equal((await call(d, "memory.trash.search", { q: "rent is due" })).data.facts.length, 0, "Archive is out of Trash search");
    const archived = (await call(d, "memory.trash.search", { q: "rent is due", area: "archive" })).data.facts;
    assert.equal(archived[0]?.factId, rent.factId);
    const restored = await call(d, "memory.restore", { factId: rent.factId });
    assert.equal(restored.data.restoredFrom, "archive");
    assert.equal((await current(d, keeper.id)).some((f) => f.factId === rent.factId), true);

    // an erase removes the content and leaves a contentless line
    assert.equal((await call(d, "memory.erase", { factIds: [rent.factId], reason: "asked by the person" })).data.erased, 1);
    assert.equal((await call(d, "memory.fact.get", { factId: rent.factId })).status, 404);
    const lines = (await call(d, "memory.trail", { factId: rent.factId })).data.rows as Array<Record<string, unknown>>;
    const erase = lines.find((l) => l["action"] === "erase")!;
    assert.equal(erase["reason"], "asked by the person");
    assert.ok(!JSON.stringify(lines).includes("rent is due"), "the trail holds no words");
    assert.deepEqual(lines.map((l) => l["action"]).sort(), ["archive", "delete", "delete", "erase", "learn", "restore", "restore"].sort());
  } finally { await d.stop(); }
});

test("memory core live: require review holds what an agent saves for the Space in Proposed", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const keeper = await newAgent(d, "Keeper");
    const open = await say(d, keeper.id, `TOOL memory_propose ${JSON.stringify({ idempotencyKey: "r1", layer: "space", text: "The office closes at five on Fridays.", sourceKind: "manual", sourceRef: "ops" })}`, "r1");
    assert.match(open.reply, /TOOL RESULT ok/, open.reply);
    assert.match(open.reply, /"merged":true/, "review is off: the agent's fact is saved");
    const set = await call(d, "settings.set_space", { key: "memory.require_review", value: true, idempotencyKey: "mc-review" });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    const held = await say(d, keeper.id, `TOOL memory_propose ${JSON.stringify({ idempotencyKey: "r2", layer: "space", text: "Invoices go out on the last Monday.", sourceKind: "manual", sourceRef: "ops" })}`, "r2");
    assert.match(held.reply, /TOOL RESULT ok/, held.reply);
    assert.match(held.reply, /"merged":false/, "review is on: it waits");
    const waiting = (await call(d, "memory.facts.list", { layer: "space", status: ["proposed"] })).data.facts as Fact[];
    assert.ok(waiting.some((f) => f.text.includes("last Monday")), JSON.stringify(waiting));
    const feed = (await call(d, "memory.learned", {})).data.items as Array<{ fact: Fact }>;
    assert.ok(feed.some((i) => i.fact.status === "proposed" && i.fact.text.includes("last Monday")), "a held fact is in the feed too");
  } finally { await d.stop(); }
});
