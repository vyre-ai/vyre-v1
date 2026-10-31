// The engine runtime on a booted daemon (P-L2_23): built the first time a handler or the periodic job runs with the module's database, bound so the control handlers reach it, and told
// to recover the threads a dead host left mid-turn. Everything it needs from outside arrives through `EngineHostSeam` (host/src/seams/engine.ts): a way to call capabilities as a
// person, and the opener of real sessions. The turn engine itself stays in agent/src/turn-engine and knows nothing about modules.
import { createTurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { TurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { AccountQuery, EngineEvent, OpenSession, ResolvedAccount, TurnRow } from "../../agent/src/turn-engine/types.ts";
import { open } from "./handlers/control.ts";
import { bindBridge, createBridge } from "./handlers/bridge.ts";
import type { StreamEvent } from "./handlers/bridge.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import { createEngineApiTools } from "./api-tools.ts";
import { buildNodeOpener, buildOpener, roleBlocks } from "./session.ts";
import { remoteLauncher, routed } from "./node-turns.ts";
import type { NodeRelay } from "./node-turns.ts";
import { withRecall } from "./recall.ts";
import { withChatSettings } from "./chat-settings.ts";
import { createLimitSwitch } from "./switch-on-limit.ts";
import { checkedOpen, createRunnableAccount } from "./runnable-account.ts";
import type { NodeCliProbe } from "./cli-programs.ts";
import { createContextBuilder, diskSkills, takeHandoff, withTurnContext } from "./context.ts";
import { withTranscript } from "./transcript.ts";
import { recordAccountLimits } from "./handlers/usage.ts";
import { reviewAfter, reviewerOf } from "./handlers/reviewer.ts";
import { onTurnEnded } from "./handlers/task-baton.ts";
import { defaultSandbox } from "./sandbox-default.ts";
import { closePluginRuntime, pluginRuntime } from "./plugin-host.ts";
import { createPluginTools } from "./plugin-tools.ts";
import type { DefaultSandbox } from "./sandbox-default.ts";
import type { SandboxPlan } from "./sandbox.ts";
import type { EngineSessionPorts } from "./session.ts";
import type { PostAs } from "./handlers/bridge.ts";
import { bindEngine, bindOpener, bindStepOpen, mintEngineId, sqlLeases, sqlMessages, sqlQueue, sqlWaits } from "./projections.ts";
import type { Db, EngineCtx } from "./projections.ts";

export interface EngineHostSeam {
  /** 'host:<space>' for the lease. */
  holder: string;
  /** Call a capability. `as` is the person it runs for (the asker, the payer); omitted is the host's own service principal. */
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  /** The real session opener. A daemon passes the host's `session` ports instead and the module builds it; a test passes a scripted one here. */
  openSession?: OpenSession;
  /** The host's ports for the real opener (Vault lookup, loopback MCP, scrub-miss report). With these and no `openSession`, the module builds the opener itself. */
  session?: EngineSessionPorts;
  /** Where CLI engines run sandboxed (work folders, the wall). Absent: CLI turns fail closed. */
  sandbox?: SandboxPlan;
  /** The host's invoke pipeline, for tools on API-key chats: each tool call is one capability invoke as the agent acting for the asker. Absent: an API chat answers in words only. */
  invoke?: Invoke;
  space?: string;
  /** The computers that joined the Space, for a turn pinned to one of them (node-turns.ts). Absent: no turn runs on a server. */
  nodes?: NodeRelay;
  /** True when the person is on their own computer (a local model on this machine is then reachable). */
  own?: (person: string) => boolean;
  /** CLI engines: swap a program for a command (a fake CLI in a test), and extra read-only folders the sandbox must expose for it. Default: the real CLI, nothing extra. */
  cli?: { command?: Readonly<Record<string, readonly string[]>>; programRead?: readonly string[]; /** Where programs are looked for (a test's own folders); default: this computer's PATH. */ probe?: NodeCliProbe };
  /** The Space data directory. With it and no `sandbox`, the module builds the default sandbox for this platform on the first CLI turn (sandbox-default.ts). */
  dataDir?: string;
  now?: () => number;
  /** The fetch for remote MCP servers: the network guard's (lib/net-guard.ts), so a private address is refused. Absent: a remote server answers "unavailable". */
  mcpFetch?: unknown;
  /** Replaces how a plugin's process is started (a test launcher). Default: the sandbox. */
  pluginLaunch?: unknown;
  /** Where the bridge logs a turn that failed or a reply it could not post. */
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
  /** Run chat.post as an agent (the host builds the call with the agent as principal). With it the chat bridge is attached: the engine's replies become chat posts. */
  postAs?: PostAs;
  /** The skills the turn context indexes and loads a focus skill from. Default: the built-in skills on disk (agent/skills). */
  skills?: import("./context.ts").SkillsPort;
  /** Live turn events (text as it is written, the end, the message it became) for the host to put on the live socket. */
  stream?: (e: StreamEvent) => void;
  /** Runs once the runtime exists and before it is bound (the chat bridge attaches here). */
  extend?: (engine: TurnEngine) => void;
}

interface AccountRow { ref: string; driver: string; kind: "api_key" | "subscription"; base?: string; keyless?: boolean }
interface ResolveOut { accountRef: string | null; payer: string | null; reason: ResolvedAccount["reason"]; allowed: boolean; itemId?: string }

/** The provider a driver belongs to, for the session spec; the CLI engines run their vendor's models. */
const PROVIDER_OF_DRIVER: Readonly<Record<string, string>> = Object.freeze({ claude_code: "anthropic", codex: "openai", grok: "xai" });
export const providerOfDriver = (driver: string): string => PROVIDER_OF_DRIVER[driver] ?? driver;

let host: EngineHostSeam | null = null;
let building: Promise<TurnEngine | null> | null = null;
let closeOpener: (() => Promise<void>) | null = null;

/** The module's seam: the daemon calls this at boot with the host half (null at shutdown). */
export function setEngineHost(h: EngineHostSeam | null): void {
  if (h === null) void closePluginRuntime();   // plugin servers end with the daemon
  if (h === null && closeOpener) void closeOpener().catch(() => undefined);   // processes end and MCP tokens are revoked at shutdown
  closeOpener = null;
  host = h;
  building = null;
  if (h === null) { bindEngine(null); bindBridge(null); bindOpener(null); completer = null; bindStepOpen(null); }
}

export function engineHost(): EngineHostSeam | null { return host; }

/** The sandbox plan plugin code runs in: the host's own, or the default for this platform. Rejects where nothing can confine it, and then nothing starts. */
export function sandboxPlan(): Promise<SandboxPlan> {
  const h = host;
  if (h?.sandbox) return Promise.resolve(h.sandbox);
  if (h?.dataDir) return defaultPlan(h.dataDir, h.cli?.programRead)();
  return Promise.reject(new Error("no sandbox is set up on this computer"));
}

async function resolveOne(h: EngineHostSeam, q: AccountQuery): Promise<ResolvedAccount | null> {
  const res = (await h.call("engine.account.resolve", { threadId: q.threadId, agentId: q.agentId, askerId: q.askerId, ...(q.stepKey ? { stepKey: q.stepKey } : {}), ...(q.unavailable?.length ? { unavailable: [...q.unavailable] } : {}) }, q.askerId)) as ResolveOut;
  if (!res.allowed || !res.accountRef || !res.payer) {
    h.log?.("no account can pay for this turn", { threadId: q.threadId, agentId: q.agentId, asker: q.askerId, allowed: res.allowed, reason: res.reason, accountRef: res.accountRef ?? null });
    return null;
  }
  const list = (await h.call("engine.accounts.list", {}, res.payer)) as { accounts: AccountRow[] };
  const row = list.accounts.find((a) => a.ref === res.accountRef);
  if (!row) { h.log?.("the account the turn resolved is not in the payer's list", { threadId: q.threadId, accountRef: res.accountRef, payer: res.payer }); return null; }   // the key vanished between the two calls: treat as none, the next turn asks again
  return { ref: row.ref, driver: row.driver, provider: providerOfDriver(row.driver), kind: row.kind, payer: res.payer, reason: res.reason, ...(res.itemId ? { itemId: res.itemId } : {}), ...(row.base ? { base: row.base } : {}), ...(row.keyless ? { keyless: true } : {}) };
}

/** An account whose engine can run on this computer: the pick, or another account of the person when the pick's program is not installed (runnable-account.ts). */
function runnableAccount(h: EngineHostSeam): (q: AccountQuery) => Promise<ResolvedAccount | null> {
  return createRunnableAccount({
    call: h.call, resolve: (q) => resolveOne(h, q), ...(h.cli?.command ? { command: h.cli.command } : {}), ...(h.cli?.probe ? { probe: h.cli.probe } : {}),
    ...(h.postAs ? { postAs: h.postAs } : {}), ...(h.log ? { log: h.log } : {}),
  });
}

/** The task an unattended turn with no AI account leaves for the person. A chat turn leaves none: the chat shows it inline (apps/app/src/places/chats/conversation/status.ts). The app opens the direct sign-in for it (apps/app/src/places/chats/needsyou/account.ts holds the same title; test/no-account-title.test.ts keeps them equal). */
export const NO_ACCOUNT_TITLE = "Connect an AI account";
/** Titles earlier builds gave the same task; the sweep closes those too. */
const NO_ACCOUNT_TITLES: ReadonlySet<string> = new Set([NO_ACCOUNT_TITLE, "Add a key so your agent can answer"]);

type NoAccountInfo = { threadId: string; turnId: string; agentId: string; asker: string; routine: boolean };

async function unblock(h: EngineHostSeam, db: Db, info: NoAccountInfo): Promise<void> {
  if (!info.routine) return;   // a person is in the chat: the failed turn says so there, and no task piles up per message
  const key = `no-account:${info.asker}`;   // one per person, whatever the thread or the run
  const made = (await h.call("tasks.create", {
    kind: "unblock", title: NO_ACCOUNT_TITLE, summary: "So your agent can answer.",
    assigned: { kind: "person", id: info.asker }, source: { kind: "chat", id: info.threadId }, idempotencyKey: key,
  }, info.asker)) as { task?: { id?: string } };
  const taskId = made.task?.id;
  if (taskId) db.run("INSERT OR REPLACE INTO engine_unblock (task_id, thread_id, agent_id, asker, at) VALUES (?, ?, ?, ?, ?)", taskId, info.threadId, info.agentId, info.asker, (h.now ?? Date.now)());
}

/**
 * Closes every open no-account Unblock whose person now has a usable AI account (a connected, working one). Runs when a provider is added and at boot, so the tasks older builds piled up
 * go away by themselves. The task is canceled as the person it is assigned to (they are who it was for); the wake row goes with it. Returns the ids it closed.
 */
export async function closeNoAccountTasks(db: Db): Promise<string[]> {
  const h = host;
  if (!h) return [];
  const listed = (await h.call("tasks.list", { scope: "all", kinds: ["unblock"], states: ["todo", "doing"], limit: 200 })) as { tasks?: Array<{ id: string; title: string; assigned?: { kind?: string; id?: string } }> };
  const mine = (listed.tasks ?? []).filter((t) => NO_ACCOUNT_TITLES.has(t.title) && t.assigned?.kind === "person" && typeof t.assigned.id === "string");
  const usable = new Map<string, boolean>();
  const closed: string[] = [];
  for (const t of mine) {
    const person = t.assigned!.id as string;
    if (!usable.has(person)) {
      try { usable.set(person, ((await h.call("engine.accounts.list", {}, person)) as { accounts?: Array<{ status?: string }> }).accounts?.some((a) => a.status === "ok") === true); }
      catch { usable.set(person, false); }
    }
    if (!usable.get(person)) continue;
    try {
      await h.call("tasks.transition", { taskId: t.id, to: "canceled", note: "An AI account is connected." }, person);
      db.run("DELETE FROM engine_unblock WHERE task_id = ?", t.id);
      closed.push(t.id);
    } catch (e) { h.log?.("could not close a no-account task", { taskId: t.id, error: e instanceof Error ? e.message : String(e) }); }
  }
  return closed;
}

async function meter(h: EngineHostSeam, turn: Readonly<TurnRow>, account: ResolvedAccount | null): Promise<void> {
  if (turn.tokensIn + turn.tokensOut === 0) return;
  await h.call("engine.turn.record_usage", { turnId: turn.id, tokensIn: turn.tokensIn, tokensOut: turn.tokensOut, costMicros: 0, ...(account?.itemId ? { itemId: account.itemId } : {}) }, turn.asker);
}

export interface CompleteIn { account: ResolvedAccount; system?: string; prompt: string; model?: string }
export interface CompleteOut { text: string; tokensIn: number; tokensOut: number }
let completer: ((i: CompleteIn) => Promise<CompleteOut>) | null = null;
/** One request and one answer on an account, through the same opener the turn engine uses: for jobs that need a model but are not a chat (memory upkeep). Null before the runtime exists. */
export const completerOf = (): typeof completer => completer;

/** Run one turn of a pseudo-agent on the account and collect its text and token counts. */
async function oneShot(openSession: OpenSession, i: CompleteIn, now: () => number): Promise<CompleteOut> {
  const n = now();
  const threadId = `oneshot_${n.toString(36)}`;
  const agent = { id: "memory-upkeep", name: "Memory upkeep", mode: "lead" as const, ...(i.system ? { role: i.system } : {}), ...(i.model ? { model: i.model } : {}), accountRef: i.account.ref };
  const session = await openSession({ threadId, agent, asker: i.account.payer, turnId: `trn_${n.toString(36)}`, traceId: "0".repeat(32), account: i.account });
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const trigger = { id: `msg_${n.toString(36)}`, threadId, threadSeq: 1, author: { kind: "person" as const, id: i.account.payer }, mentions: [], depth: 0, body: i.prompt };
    for await (const ev of session.send({ threadId, turnId: `trn_${n.toString(36)}`, agent, trigger, history: [], listeners: [], asker: i.account.payer })) {
      if (ev.type === "text") text += ev.text;
      else if (ev.type === "usage") { tokensIn += ev.inputTokens; tokensOut += ev.outputTokens; }
      else if (ev.type === "error") throw new Error(`${ev.code}: ${ev.message}`);
      else if (ev.type === "done") break;
    }
  } finally { await session.close().catch(() => undefined); }
  return { text, tokensIn, tokensOut };
}

let defaultBuilt: DefaultSandbox | null = null;
/** The default sandbox plan for this platform, built once per runtime. */
export const defaultPlan = (dataDir: string, programRead?: readonly string[]) => async (): Promise<SandboxPlan> => (defaultBuilt ??= await defaultSandbox({ dataDir, ...(programRead ? { programRead } : {}) })).plan;
/** Stop the default sandbox's wall (daemon shutdown, tests). */
export async function closeDefaultSandbox(): Promise<void> { const d = defaultBuilt; defaultBuilt = null; await d?.close(); }

/**
 * Build and bind the runtime, once, on this module's database; then recover threads a dead host left with work queued or running. Returns null when no host half is configured
 * (a daemon without the engine seam, or a unit test), in which case the control handlers keep raising internal.unavailable.
 */
export function ensureRuntime(ctx: Pick<EngineCtx, "db">): Promise<TurnEngine | null> {
  if (!host || (!host.openSession && !host.session)) return Promise.resolve(null);   // no way to open a session: the control handlers keep answering internal.unavailable
  const h = host;
  const apiTools = host.invoke && host.space ? createEngineApiTools({ invoke: host.invoke, space: host.space, system: roleBlocks(h.call), call: h.call, plugins: createPluginTools({ call: h.call, runtime: pluginRuntime, ...(h.log ? { log: h.log } : {}) }) }) : undefined;
  const opener = host.openSession ? null : buildOpener({ ...(h.own ? { own: h.own } : {}), ...(apiTools ? { apiTools } : {}), session: host.session as EngineSessionPorts, call: h.call, ...(host.sandbox ? { sandbox: host.sandbox } : {}), ...(host.cli?.command ? { cliCommand: host.cli.command } : {}), ...(host.cli?.probe ? { cliProbe: host.cli.probe } : {}), ...(host.dataDir ? { dataDir: host.dataDir, defaultSandbox: defaultPlan(host.dataDir, host.cli?.programRead) } : {}) });
  const baseOpen = host.openSession ?? checkedOpen((opener as NonNullable<typeof opener>).openSession, { ...(host.cli?.command ? { command: host.cli.command } : {}), ...(host.cli?.probe ? { probe: host.cli.probe } : {}) });
  // a turn the person pinned to one of their servers opens through that server's opener; everything else opens as before
  const nodeOpeners = new Map<string, ReturnType<typeof buildNodeOpener>>();
  const openerHost = { ...(h.own ? { own: h.own } : {}), ...(apiTools ? { apiTools } : {}), session: host.session as EngineSessionPorts, call: h.call };
  const nodeOpener = (nodeId: string) => {
    let o = nodeOpeners.get(nodeId);
    if (!o) { o = buildNodeOpener(openerHost, remoteLauncher(h.nodes as NodeRelay, nodeId)); nodeOpeners.set(nodeId, o); }
    return o.openSession;
  };
  const openSession = host.session && h.nodes && !host.openSession ? routed(baseOpen, { call: h.call, relay: h.nodes, nodeOpener, db: ctx.db }) : baseOpen;
  closeOpener = opener ? async () => { await opener.close(); await Promise.all([...nodeOpeners.values()].map((o) => o.close())); } : null;
  building ??= (async () => {
    const now = h.now ?? Date.now;
    const bridge = h.postAs ? createBridge({ postAs: h.postAs, now, ...(h.stream ? { stream: h.stream } : {}), addressAsker: (threadId, agentId) => { const r = reviewerOf(ctx.db, threadId); return r?.kind === "agent" && r.id === agentId; }, ...(h.log ? { log: { warn: h.log } } : {}), callAs: (cap, input, person) => h.call(cap, input, person) }) : null;
    // The turn context is built as the asker before each turn (modules/engine/context.ts); what the agent waits on is read off the engine once it exists.
    let live: TurnEngine | null = null;
    const turnContext = createContextBuilder({
      call: h.call, skills: h.skills ?? diskSkills(), now, handoff: takeHandoff,
      waiting: (threadId, agentId) => (live?.waiting(threadId) ?? []).filter((w) => w.agentId === agentId).map((w) => `an answer to task ${w.taskId} (a held call needs approval)`),
    });
    const limitSwitch = createLimitSwitch({
      call: h.call, accountFor: runnableAccount(h), now, ...(h.postAs ? { postAs: h.postAs } : {}), ...(h.log ? { log: h.log } : {}),
      modelOf: (threadId, agentId) => { try { return live?.agents(threadId).find((a) => a.id === agentId)?.model; } catch { return undefined; } },
      providerOf: async (ref, payer) => {
        const list = (await h.call("engine.accounts.list", {}, payer)) as { accounts: Array<{ ref: string; driver: string }> };
        const row = list.accounts.find((a) => a.ref === ref);
        return row ? providerOfDriver(row.driver) : undefined;
      },
    });
    const engine = createTurnEngine({
      holder: h.holder, openSession: withChatSettings(withTurnContext(withTranscript(withRecall(bridge ? bridge.tap(openSession) : openSession, h.call), h.call, now), turnContext), h.call), now,
      queue: sqlQueue(ctx.db), leases: sqlLeases(ctx.db), messages: sqlMessages(ctx.db, now), waits: sqlWaits(ctx.db), newId: (p) => mintEngineId(p, now()),
      resolveAccount: (q) => limitSwitch.resolve(q),
      nextAccount: (q) => limitSwitch.next(q),
      onNoAccount: async (info) => {
        try { await unblock(h, ctx.db, info); }
        catch (e) { h.log?.("could not open the Unblock task for a turn with no account", { threadId: info.threadId, asker: info.asker, error: e instanceof Error ? e.message : String(e) }); throw e; }
      },
      onTurnEnd: (turn, account) => meter(h, turn, account),
      onLimits: (account, reading) => recordAccountLimits(ctx.db, account.ref, reading, now()),
      ...(apiTools ? { callTool: apiTools.runner } : {}),
    });
    live = engine;
    // The reviewer seat: after a lead turn completes, the chat's reviewer is asked to check it.
    // Every turn this engine runs is reported to engine.turn.record under the engine's own id, in order per turn, so the turn list, review sampling and the agent's Working status see it.
    const recording = new Map<string, Promise<void>>();
    const report = (turnId: string, ev: Extract<EngineEvent, { type: "turn.started" | "turn.completed" | "turn.failed" | "turn.cancelled" }>): void => {
      const turn = engine.turns().find((t) => t.id === turnId);
      if (!turn) return;
      const phase = ev.type === "turn.started" ? "started" : ev.type === "turn.completed" ? "completed" : ev.type === "turn.failed" ? "failed" : "cancelled";
      const input = {
        threadId: turn.threadId, turnId, agentId: turn.agentId, phase, qseq: turn.qseq, asker: turn.asker, ...(turn.model ? { model: turn.model } : {}),
        ...(phase === "started" ? {} : { tokensIn: turn.tokensIn, tokensOut: turn.tokensOut }), ...(ev.type === "turn.failed" ? { code: ev.code } : {}),
      };
      const done = (recording.get(turnId) ?? Promise.resolve()).then(() => h.call("engine.turn.record", input, turn.asker)).then(() => undefined, (err: unknown) => {
        h.log?.("a turn could not be recorded", { turnId, phase, error: err instanceof Error ? err.message : String(err) });
      });
      recording.set(turnId, done);
      if (phase !== "started") void done.then(() => { if (recording.get(turnId) === done) recording.delete(turnId); });
    };
    engine.subscribe((ev) => {
      if (ev.type === "turn.started" || ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "turn.cancelled") report(ev.turnId, ev);
      if (ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "turn.cancelled") {
        void onTurnEnded(ctx, { call: h.call, now, ...(h.log ? { log: h.log } : {}) }, engine, ev).catch((err) => h.log?.("a task baton check failed", { threadId: ev.threadId, error: err instanceof Error ? err.message : String(err) }));
      }
      if (ev.type !== "turn.completed") return;
      void reviewAfter({ call: h.call, ...(h.postAs ? { postAs: h.postAs } : {}) }, ctx.db, engine, ev, () => mintEngineId("msg", now())).catch((err) => h.log?.("the reviewer could not be asked", { threadId: ev.threadId, error: err instanceof Error ? err.message : String(err) }));
    });
    bridge?.attach(engine);
    h.extend?.(engine);
    completer = (i) => oneShot(openSession, i, now);
    bindEngine(engine);
    bindOpener(opener);
    bindStepOpen(openSession);
    bindBridge(bridge);
    // threads with work a dead host left: queued or running rows with no live lease
    const stale = ctx.db.all("SELECT DISTINCT thread_id FROM engine_thread_queue WHERE state IN ('queued', 'running')") as Array<{ thread_id: string }>;
    for (const r of stale) {
      try {
        await open(ctx as EngineCtx, r.thread_id);
        engine.recover(r.thread_id);
      } catch { /* a thread that cannot be opened now is opened by its next message */ }
    }
    void closeNoAccountTasks(ctx.db).catch((e) => h.log?.("the no-account sweep failed", { error: e instanceof Error ? e.message : String(e) }));
    return engine;
  })().catch((e) => { building = null; throw e; });
  return building;
}

/** The person answered an Unblock (the task is done): wake the agent that had no account, in the same thread. */
export async function wakeAfterUnblock(ctx: EngineCtx, taskId: string): Promise<boolean> {
  const row = (ctx.db.all("SELECT thread_id, agent_id FROM engine_unblock WHERE task_id = ?", taskId) as Array<{ thread_id: string; agent_id: string }>)[0];
  if (!row) return false;
  ctx.db.run("DELETE FROM engine_unblock WHERE task_id = ?", taskId);
  const engine = await ensureRuntime(ctx);
  if (!engine) return false;
  await open(ctx, row.thread_id);
  engine.wake(row.thread_id, row.agent_id);
  return true;
}

type AnsweredRow = { messageId: string; author: { kind: string; id: string }; blocks?: Array<{ type?: string; id?: string; data?: Record<string, unknown> }> };

/** The answer to a question as the agent reads it: the label of the option chosen, the words the person gave, or what a card handed back (a command's output, a folder that was mounted). */
export function answerWords(data: Record<string, unknown>): string {
  const options = Array.isArray(data["options"]) ? (data["options"] as Array<{ key?: unknown; label?: unknown }>) : [];
  const one = (a: unknown): string => {
    if (typeof a === "string") return String(options.find((o) => o.key === a)?.label ?? a);
    if (a !== null && typeof a === "object" && typeof (a as { other?: unknown }).other === "string") return (a as { other: string }).other;
    return JSON.stringify(a);
  };
  const a = data["answer"];
  return (Array.isArray(a) ? a.map(one).join(", ") : one(a)).slice(0, 8000);
}

/**
 * A question block was answered (ask_question, a plan, a Mount card, a Run this card): the answer goes to the agent that asked it. Nothing woke the agent before, so a parked question never carried on.
 * The answer is posted in the thread as the person who gave it, mentioning the agent, which is the ordinary way an agent is told something: its next turn runs on the same account as any reply.
 */
export async function wakeAfterAnswer(ctx: EngineCtx, event: { payload: { threadId: string; blockId: string; by: string } }): Promise<boolean> {
  const h = host;
  if (!h) return false;
  const { threadId, blockId, by } = event.payload;
  if (!by.startsWith("usr_")) return false;
  const list = (await h.call("chat.messages.list", { threadId, limit: 100 }, by)) as { messages: AnsweredRow[] };
  for (const m of list.messages) {
    const b = (m.blocks ?? []).find((x) => x.id === blockId);
    if (!b || m.author.kind !== "agent" || b.type !== "question" || b.data === undefined) continue;
    const body = answerWords(b.data);
    if (body === "") return false;
    await h.call("chat.post", { threadId, body, mentions: [{ kind: "agent", id: m.author.id }], idempotencyKey: `answer:${blockId}` }, by);
    return true;
  }
  return false;
}
