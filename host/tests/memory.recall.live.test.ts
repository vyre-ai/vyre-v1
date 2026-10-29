// Exact recall on a booted daemon (memory design B, rulings 1 and 3): the words a person wrote in one chat come back word for word in another, with who said them, when, and a link that opens the
// chat at that line; a person who was not in the chat never gets them, not even through an agent that was; and the same question gets the same recalled words through an API-style engine (the memory
// block in its system prompt and the tools it calls) and through a CLI engine (the prompt it is sent and the tools it reaches over Vyre's MCP server). Nothing is faked inside the daemon: chat, agents,
// engine, memory and the hook runner are live. The model vendor stand-ins are scripted sessions; the CLI one is the fake CLI of host/tests/fixtures/fake-cli-driver in the platform's sandbox.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { memoryGuide } from "../../lib/memory-guide.ts";
import { CORE_SPACE, bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const FAKE_CLI = fileURLToPath(new URL("./fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const HEAVY = process.env["VYRE_HEAVY_DOCKER"] === "1";
const WORDS = "The Henderson retainer is capped at 4,500 dollars per month, no exceptions.";
const ASK = "what is the Henderson retainer cap per month?";
const FACT = "Dana prefers all client calls scheduled before 10am Pacific.";
const FACT_ASK = "when does Dana prefer client calls scheduled?";
/** What the API-style engine answered in the first test, so the CLI test can hold its own answer against it. */
const seen: { tool?: string; block?: string } = {};
const AGENT_FACT = "Intake files every new matter under the client's surname.";

/** An agent-layer fact, accepted, and the nightly job run for the agent: the map the guide is made from. Returns the folder files by name once the hook has written them. */
async function mapped(d: Daemon, agentId: string): Promise<{ folder: string; files: Record<string, string> }> {
  await d.hooks?.pump?.();   // a consumer first seen starts at the end of the log, so it is running before the night
  const made = await call(d, "memory.propose_fact", { layer: "agent", agentId, text: AGENT_FACT, sourceKind: "manual", sourceRef: "recall-live", idempotencyKey: "rc-agent-fact" });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  if (!made.data.merged) assert.equal((await call(d, "memory.fact.accept", { factId: made.data.fact.factId })).status, 200);
  const night = await call(d, "memory.maintain", { agentId, idempotencyKey: "rc-night" });
  assert.equal(night.status, 200, JSON.stringify(night.data));
  const agentRow = (await call(d, "agents.get", { agentId })).data.agent as { folderId: string };
  const folder = (await call(d, "files.folder.get", { folderId: agentRow.folderId })).data.folder.path as string;
  const read = async (name: string): Promise<string | null> => {
    await d.hooks?.pump?.();
    const r = await call(d, "files.resolve", { path: `${folder}/${name}` });
    if (r.status !== 200 || !r.data.fileId) return null;
    const t = await call(d, "files.read", { fileId: r.data.fileId, as: "text" });
    return t.status === 200 ? String(t.data.text ?? "") : null;
  };
  const files: Record<string, string> = {};
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const end = Date.now() + 20_000;
    for (;;) {
      const t = await read(name);
      if (t !== null && t.includes(AGENT_FACT)) { files[name] = t; break; }
      if (Date.now() > end) throw new Error(`${name} never held the map (it holds ${JSON.stringify(t)}); host log ${hostLog(d)}`);
      await new Promise<void>((r) => setTimeout(r, 200));
    }
  }
  return { folder, files };
}

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-recall-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

// The engine's session contract, as far as the stand-in needs it (host tests may not import the agent package, which sits above the host).
interface RecallLine { title: string; fact?: string; path: string; sourceLink?: string; kind?: string; ref?: string; by?: string }
interface TurnInput { turnId: string; trigger: { body: string } | null; recall?: readonly RecallLine[] }
type ToolResult = { ok: boolean; content: unknown };
type DriverEvent = { type: "text"; text: string } | { type: "tool_call"; id: string; name: string; input: unknown } | { type: "done" };
type OpenSession = (spec: unknown) => Promise<unknown>;

/** An API-style model: it is given the memory block as the system prompt carries it, and it answers by calling memory_quote (a tool call the engine runs through the tool session) when its message says "quote:". */
const apiStandIn: OpenSession = async () => {
  const waiting = new Map<string, (r: ToolResult) => void>();
  return {
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const text = input.trigger?.body ?? "";
      const block = JSON.stringify(input.recall ?? []);
      if (text.startsWith("quote:")) {
        const id = `call_${input.turnId}`;
        const got = new Promise<ToolResult>((ok) => waiting.set(id, ok));
        yield { type: "tool_call", id, name: "memory_quote", input: { q: text.slice(6).trim() } };
        const r = await got;
        yield { type: "text", text: `[api tool] ${JSON.stringify(r.content)}` };
      } else yield { type: "text", text: `[api block] ${block}` };
      yield { type: "done" };
    },
    sendToolResult(callId: string, result: ToolResult) { waiting.get(callId)?.(result); },
    inject() {}, async cancel() {}, async close() {},
  };
};

async function boot(dir: string, o: { cli?: boolean } = {}): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "recall-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
    // a second person of the Space, who signs in with his own id as the bearer
    session: (headers: Record<string, string | undefined>) => {
      const id = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      return ["usr_olivia", "usr_adam"].includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "recall-live" } : null;
    },
    ...(o.cli ? { engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] } } : { engineOpenSession: apiStandIn }),
  });
}

async function call(d: Daemon, cap: string, input: unknown, who?: string): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who ?? "usr_olivia"}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

function hostLog(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 30 OR msg LIKE '%engine%' ORDER BY id DESC LIMIT 20").all() as Array<{ level: number; place?: string; cap?: string; msg: string; attrs?: string }>;
  return JSON.stringify(rows.filter((r) => !/grants on an agent|neighbour|principal could not be adopted/.test(r.msg)).map((r) => `${r.level} ${r.place ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 400)}`));
}

async function waitFor<T>(f: () => Promise<T | null>, d: Daemon, ms = 40_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`waitFor: it never happened; host log ${hostLog(d)}`);
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}

async function connect(d: Daemon, who = "usr_olivia"): Promise<void> {
  const tag = who.replace("usr_", "");
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(unlock.status, 204, `unlock: ${unlock.status}`);
  const folder = await call(d, "vault.folders.create", { idempotencyKey: `rc-folder-${tag}`, name: "Accounts", scope: "mine" }, who);
  const flow = await call(d, "providers.subscription_start", { idempotencyKey: `rc-flow-${tag}`, providerKey: "claude-code" }, who);
  const item = await call(d, "vault.item.put", { idempotencyKey: `rc-item-${tag}`, folderId: folder.data.folder.id, name: `${tag}_Claude`, kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] }, who);
  assert.equal(item.status, 200, JSON.stringify(item.data));
  const provider = await call(d, "providers.subscription_complete", { flowId: flow.data.flowId }, who);
  assert.equal(provider.status, 200, JSON.stringify(provider.data));
  const allowed = await call(d, "providers.set_space_use", { idempotencyKey: `rc-spaceuse-${tag}`, providerId: provider.data.provider.id, allow: true }, who);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
  assert.equal((await call(d, "engine.pool.status", {}, who)).status, 200);
}

async function agent(d: Daemon, name: string): Promise<string> {
  const made = await call(d, "agents.create", { name, role: "You answer intake questions.", idempotencyKey: `rc-agent-${name}` });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  return made.data.agent.agentId as string;
}

/** Start a chat with the agent, write one message and wait for the agent's reply. */
async function say(d: Daemon, agentId: string, body: string, key: string, who?: string): Promise<{ threadId: string; messageId: string; reply: string }> {
  const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-start` }, who);
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const threadId = started.data.thread.threadId as string;
  const posted = await call(d, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post` }, who);
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  const reply = await waitFor(async () => {
    await d.hooks?.pump?.();
    const r = await call(d, "chat.messages.list", { threadId }, who);
    const m = (r.data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
    return m?.body ?? null;
  }, d);
  return { threadId, messageId: posted.data.message.messageId as string, reply };
}

test("recall live: the words from chat 1 come back exactly in chat 2 with who said them and a link that opens that line; only for people who were in the chat", async () => {
  const d = await boot(seededDir());
  try {
    // a key the whole Space may use, so Olivia's and Adam's turns are both paid for; the agent is pinned to it
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer usr_olivia" }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204, `unlock: ${unlock.status}`);
    const folder = await call(d, "vault.folders.create", { idempotencyKey: "rc-shared-folder", name: "Team keys", scope: "shared" });
    assert.equal(folder.status, 200, JSON.stringify(folder.data));
    const shared = await call(d, "providers.add", { idempotencyKey: "rc-shared", providerKey: "anthropic", connection: "api_key", apiKey: KEY, scope: "shared", folderId: folder.data.folder.id });
    assert.equal(shared.status, 200, JSON.stringify(shared.data));
    assert.equal((await call(d, "engine.pool.status", {})).status, 200);
    const helper = await agent(d, "Keeper");
    const pinned = await call(d, "agents.update", { agentId: helper, patch: { accountPolicy: "key", accountKey: shared.data.provider.handle }, idempotencyKey: "rc-pin" });
    assert.equal(pinned.status, 200, JSON.stringify(pinned.data));
    const first = await say(d, helper, WORDS, "rc1");
    assert.doesNotMatch(first.reply, /Henderson retainer is capped/, "nothing is recalled before anything is said");

    // memory.quote: the exact words, the author, the time and the link
    const q = await call(d, "memory.quote", { q: ASK });
    assert.equal(q.status, 200, JSON.stringify(q.data));
    const hit = (q.data.quotes as Array<{ text: string; ref: string; link: string; author: { id: string }; at: number; threadId: string }>).find((x) => x.text === WORDS);
    assert.ok(hit, JSON.stringify(q.data));
    assert.equal(hit.ref, first.messageId);
    assert.equal(hit.threadId, first.threadId);
    assert.equal(hit.link, `vyre://thread/${first.threadId}?m=${first.messageId}`);
    assert.equal(hit.author.id, "usr_olivia");
    assert.ok(Math.abs(hit.at - Date.now()) < 3_600_000);
    const whole = await call(d, "memory.quote", { ref: first.messageId });
    assert.equal(whole.data.quotes[0].text, WORDS);

    // chat 2: the engine put the quote in the model's memory block with its source id
    const second = await say(d, helper, ASK, "rc2");
    const quoted = (JSON.parse(second.reply.replace(/^\[api block\] /, "")) as RecallLine[]).find((l) => l.kind === "quote" && l.ref === first.messageId);
    assert.ok(quoted, second.reply);
    assert.equal(quoted.fact, WORDS);
    assert.equal(quoted.sourceLink, `vyre://thread/${first.threadId}?m=${first.messageId}`);
    assert.equal(quoted.by, "you");

    // a fact saved through memory.remember is recalled by the same question in a new chat, with its id for memory_forget
    const saved = await call(d, "memory.remember", { text: FACT, kind: "preference", threadId: first.threadId, agentId: helper });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.merged, true);
    const factChat = await say(d, helper, FACT_ASK, "rc2b");
    const factLine = (JSON.parse(factChat.reply.replace(/^\[api block\] /, "")) as RecallLine[]).find((l) => l.ref === saved.data.fact.factId);
    assert.ok(factLine, factChat.reply);
    assert.equal(`${factLine.title}: ${factLine.fact}`, `Preference: ${FACT}`);
    seen.block = `${factLine.title}: ${factLine.fact}`;

    // someone who was not in the chat gets nothing, by the capability or through the agent
    const adam = await call(d, "memory.quote", { q: ASK }, "usr_adam");
    assert.equal(adam.status, 200, JSON.stringify(adam.data));
    assert.deepEqual(adam.data.quotes, []);
    assert.deepEqual((await call(d, "memory.quote", { ref: first.messageId }, "usr_adam")).data.quotes, []);
    const viaAgent = await say(d, helper, `quote: ${ASK}`, "rc3", "usr_adam");
    assert.ok(!viaAgent.reply.includes("4,500"), `an agent that sat in the chat must not carry it to someone who did not: ${viaAgent.reply}`);
    assert.match(viaAgent.reply, /\[api tool\].*quotes/, "the tool ran and answered, with nothing in it");
    // the same agent for the person who was there does carry it
    const forOlivia = await say(d, helper, `quote: ${ASK}`, "rc4");
    assert.ok(forOlivia.reply.includes(WORDS), forOlivia.reply);
    seen.tool = WORDS;

    // the agent's map becomes CLAUDE.md and AGENTS.md in its folder, the same text in both, and follows MAP.md when the night runs again
    const m = await mapped(d, helper);
    assert.equal(m.files["CLAUDE.md"], m.files["AGENTS.md"]);
    assert.ok(m.files["CLAUDE.md"]!.startsWith("<!-- Written by Vyre memory from MAP.md."), m.files["CLAUDE.md"]);
    const map = (await call(d, "memory.map.get", { agentId: helper })).data.map as { body: string };
    assert.equal(m.files["CLAUDE.md"], memoryGuide("Keeper", map.body), "the guide is the map, rendered");
    for (const tool of ["memory_search", "memory_quote", "memory_remember", "memory_forget"]) assert.ok(m.files["AGENTS.md"]!.includes(tool), tool);
  } finally { await d.stop(); }
});

test("recall live: a CLI engine reaches the same words over Vyre's MCP server, in the sandbox, and gets the same line the API-style engine gets", { skip: HEAVY ? false : "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)" }, async () => {
  const dir = seededDir();
  const d = await boot(dir, { cli: true });
  try {
    await connect(d);
    const helper = await agent(d, "Keeper");
    // a message in an earlier chat (written by the person; no engine is needed to say it)
    const earlier = await call(d, "chat.start", { kind: "chat", agentIds: [helper], idempotencyKey: "rc-cli-start1" });
    const thread = earlier.data.thread.threadId as string;
    const posted = await call(d, "chat.post", { threadId: thread, body: WORDS, idempotencyKey: "rc-cli-post1" });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const id = posted.data.message.messageId as string;
    // the CLI is asked to call memory_quote; its answer is what the tool said over MCP, as the agent acting for the person
    const turn = await say(d, helper, `tool memory_quote ${JSON.stringify({ q: ASK })}`, "rc-cli2");
    assert.match(turn.reply, /^memory_quote answered: /, turn.reply);
    const said = JSON.parse(turn.reply.slice("memory_quote answered: ".length)) as { data?: { quotes?: Array<{ text: string; ref: string; link: string }> } };
    const line = said.data?.quotes?.find((x) => x.ref === id);
    assert.ok(line, turn.reply);
    assert.equal(line.text, WORDS);
    assert.equal(line.link, `vyre://thread/${thread}?m=${id}`);
    if (seen.tool) assert.equal(line.text, seen.tool, "the CLI path recalls the same words the API-style path did");

    // the prompt the CLI is sent carries the same quote with its source id, as the API-style system block does
    const ask = await say(d, helper, ASK, "rc-cli3");
    assert.ok(ask.reply.includes(`Quote [${id}]`) && ask.reply.includes(`"${WORDS}"`) && ask.reply.includes(`vyre://thread/${thread}?m=${id}`), ask.reply);

    // the CLI's work folder holds the same guide for the agent, so Claude Code and Codex find it where they start
    await mapped(d, helper);
    const guided = await say(d, helper, "hello", "rc-cli-guide");
    assert.ok(guided.threadId);
    const work = path.join(dir, "work", "usr_olivia", guided.threadId);
    const inFolder = (name: string): string => fs.readFileSync(path.join(work, name), "utf8");
    assert.equal(inFolder("CLAUDE.md"), inFolder("AGENTS.md"));
    assert.ok(inFolder("CLAUDE.md").includes(AGENT_FACT), inFolder("CLAUDE.md"));

    // memory tools over MCP: remember a fact, find it with memory_search, see it recalled for the same question, forget it, and see it gone
    const rem = await say(d, helper, `tool memory_remember ${JSON.stringify({ text: FACT, kind: "preference", threadId: thread })}`, "rc-cli4");
    assert.match(rem.reply, /^memory_remember answered: /, rem.reply);
    const factId = (JSON.parse(rem.reply.slice("memory_remember answered: ".length)) as { data: { fact: { factId: string; status: string } } }).data.fact;
    assert.equal(factId.status, "current");
    const found = await say(d, helper, `tool memory_search ${JSON.stringify({ q: FACT_ASK })}`, "rc-cli5");
    assert.match(found.reply, /^memory_search answered: /, found.reply);
    assert.ok(found.reply.includes(FACT), found.reply);
    const recalled = await say(d, helper, FACT_ASK, "rc-cli6");
    assert.ok(recalled.reply.includes(`[${factId.factId}] Preference: ${FACT}`), recalled.reply);
    if (seen.block) assert.ok(recalled.reply.includes(seen.block), "both paths carry the same fact line");
    const gone = await say(d, helper, `tool memory_forget ${JSON.stringify({ factIds: [factId.factId] })}`, "rc-cli7");
    assert.match(gone.reply, /^memory_forget answered: /, gone.reply);
    const after = await say(d, helper, FACT_ASK, "rc-cli8");
    assert.doesNotMatch(after.reply, new RegExp(`^- \\[${factId.factId}\\]`, "m"), "a forgotten fact is not a fact line any more (the words people wrote stay findable as quotes)");
  } finally { await d.stop(); }
});
