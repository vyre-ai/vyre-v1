// The engine runtime on a booted daemon (P-L2_23): built the first time a handler or the periodic job runs with the module's database, bound so the control handlers reach it, and told
// to recover the threads a dead host left mid-turn. Everything it needs from outside arrives through `EngineHostSeam` (host/src/seams/engine.ts): a way to call capabilities as a
// person, and the opener of real sessions. The turn engine itself stays in agent/src/turn-engine and knows nothing about modules.
import path from "node:path";
import { createTurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { TurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { AccountQuery, EngineEvent, OpenSession, ResolvedAccount, TurnRow } from "../../agent/src/turn-engine/types.ts";
import { open } from "./handlers/control.ts";
import { BRIDGE_PREFIX, bindBridge, createBridge } from "./handlers/bridge.ts";
import { screenAnswer, settleAnswer } from "./answer-audience.ts";
import { ANSWER_HELD } from "../../agent/src/turn-engine/engine.ts";
import { clearReads } from "../../host/src/seams/answer-reads.ts";
import { createCrewWatcher } from "./crew-watch.ts";
import type { StreamEvent } from "./handlers/bridge.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import { createEngineApiTools } from "./api-tools.ts";
import { buildNodeOpener, buildOpener, roleBlocks } from "./session.ts";
import { remoteLauncher, routed, waitsForComputer } from "./node-turns.ts";
import { bindRelay } from "./relay.ts";
import { finishRoutineRun } from "./handlers/routine-run.ts";
import { withHeldNotes } from "./held-notes.ts";
import { DEVICE_WAIT_LINE, DEVICE_WAIT_STEP, SLEPT_WAIT_LINE } from "./device-turns.ts";
import type { NodeRelay } from "./node-turns.ts";
import { withRecall } from "./recall.ts";
import { withAudienceReset } from "./audience-reset.ts";
import { withChatSettings } from "./chat-settings.ts";
import { withSpaceKeyTurns } from "./space-key-turns.ts";
import { noteModelFallback } from "./model-fallback.ts";
import { createLimitSwitch } from "./switch-on-limit.ts";
import { checkedOpen, createRunnableAccount } from "./runnable-account.ts";
import { skipLocked } from "./locked-account.ts";
import type { NodeCliProbe } from "./cli-programs.ts";
import { configureEngines, engines, enginesRoot } from "./engine-install.ts";
import { capabilitySkills, createContextBuilder, takeHandoff, withTurnContext } from "./context.ts";
import { withTranscript } from "./transcript.ts";
import { withNativeSkills } from "./skills-native.ts";
import { linkReply } from "./handlers/extra/reply-info.ts";
import { costOf } from "./turn-cost.ts";
import { workFolder } from "./sandbox.ts";
import { createCompactor, withCompaction } from "./compact.ts";
import type { Compactor } from "./compact.ts";
import { keepEvery, keepsSession, resumeId, saveResumeId } from "./cli-sessions.ts";
import { recordAccountLimits } from "./handlers/usage.ts";
import { learnAfterTurn } from "./learn.ts";
import { reviewAfter, reviewerOf } from "./handlers/reviewer.ts";
import { onTurnEnded, resumeTasks } from "./handlers/task-baton.ts";
import { ensureExtra } from "./handlers/extra/schema.ts";
import { createKeepAwake } from "./keep-awake.ts";
import { coalesceLive } from "./live-coalesce.ts";
import { cliSandboxCode, cliSandboxGap, defaultSandbox, egressPolicyOf, wallEgress, windowsMode } from "./sandbox-default.ts";
import { wslOn } from "../../sandbox/src/wsl/wsl.ts";
import { EGRESS_SETTING, recordEgress } from "./egress-log.ts";
import type { AccessAsked, EgressRule } from "../../sandbox/src/index.ts";
import { closePluginRuntime, pluginRuntime } from "./plugin-host.ts";
import { bindOauthStore } from "./mcp-oauth.ts";
import { bindModelLister } from "./live-models.ts";
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
  /** A Space server only: does it hold this person's key now (locked-account.ts). Absent on a person's own computer. */
  keyHeld?: (person: string) => boolean;
  /** Is this module db handle this daemon's own? Two daemons in one process (the two-computer tests) share the engine module, and only the daemon whose host half it holds builds its runtime. */
  ours?: (db: unknown) => boolean;
  /** CLI engines: swap a program for a command (a fake CLI in a test), and extra read-only folders the sandbox must expose for it. Default: the real CLI, nothing extra. */
  cli?: { command?: Readonly<Record<string, readonly string[]>>; programRead?: readonly string[]; /** Where programs are looked for (a test's own folders); default: this computer's PATH. */ probe?: NodeCliProbe; /** A test's stand-in for the providers the API drivers call. */ apiFetch?: typeof fetch };
  /** The Space data directory. With it and no `sandbox`, the module builds the default sandbox for this platform on the first CLI turn (sandbox-default.ts). */
  dataDir?: string;
  /** Vyre installs a missing CLI engine into its own engines folder (engine-install.ts). The daemon's entry turns it on; a test daemon leaves it off and never downloads anything. */
  engines?: { install?: boolean };
  now?: () => number;
  /** The fetch for remote MCP servers: the network guard's (lib/net-guard.ts), so a private address is refused. Absent: a remote server answers "unavailable". */
  mcpFetch?: unknown;
  /** Replaces how a plugin's process is started (a test launcher). Default: the sandbox. */
  pluginLaunch?: unknown;
  /** Where the bridge logs a turn that failed or a reply it could not post. */
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
  /** Run chat.post as an agent (the host builds the call with the agent as principal). With it the chat bridge is attached: the engine's replies become chat posts. */
  postAs?: PostAs;
  /** May every one of these people do this on this resource, each on their own grants (the answer check, modules/engine/answer-audience.ts)? Absent: answers are posted unchecked, as before. */
  mayAll?(people: readonly string[], action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }): boolean;
  /** The skills the turn context indexes and loads a focus skill from. Default: the skills module's loader (skills.list and skills.load as the asker), with the built-ins on disk when it cannot answer. */
  skills?: import("./context.ts").SkillsPort;
  /** Live turn events (text as it is written, the end, the message it became) for the host to put on the live socket. */
  stream?: (e: StreamEvent) => void;
  /** Runs once the runtime exists and before it is bound (the chat bridge attaches here). */
  extend?: (engine: TurnEngine) => void;
  /** Told at shutdown with the promise of the engine's close (CLI sessions ended, the sign-ins they refreshed saved), so the daemon waits for it before its databases close. */
  closing?: (done: Promise<void>) => void;
  /** Set by the module when a later host half has replaced this one while its opener was still open: closes that opener. The seam wiring calls it when this daemon stops. */
  retire?: () => Promise<void>;
  /** Told how many turns run here now, each time it changes (the desktop shell waits for 0 before it updates the app). */
  turns?: (running: number) => void;
}

interface AccountRow { ref: string; driver: string; kind: "api_key" | "subscription"; mine?: boolean; base?: string; keyless?: boolean; spaceKey?: boolean }
interface ResolveOut { accountRef: string | null; payer: string | null; reason: ResolvedAccount["reason"]; allowed: boolean; itemId?: string; fellBack?: boolean; via?: ResolvedAccount["via"]; cappedFrom?: string; modelFallback?: { from: string; to?: string } }

/** The provider a driver belongs to, for the session spec; the CLI engines run their vendor's models. */
const PROVIDER_OF_DRIVER: Readonly<Record<string, string>> = Object.freeze({ claude_code: "anthropic", codex: "openai", grok: "xai" });
export const providerOfDriver = (driver: string): string => PROVIDER_OF_DRIVER[driver] ?? driver;

const awake = createKeepAwake();
let host: EngineHostSeam | null = null;
let building: Promise<TurnEngine | null> | null = null;
let closeOpener: (() => Promise<void>) | null = null;

/** The module's seam: the daemon calls this at boot with the host half (null at shutdown). */
export function setEngineHost(h: EngineHostSeam | null): void {
  if (h === null) { void closePluginRuntime(); awake.stop(); }   // plugin servers end with the daemon, and so does holding the computer awake
  // At shutdown the engine processes end and MCP tokens are revoked, and then the default sandbox's wall (its egress proxy) stops: the proxy outlives nothing it served, and nothing keeps the daemon's process alive.
  if (h === null) {
    const done = (closeOpener ? closeOpener().catch(() => undefined) : Promise.resolve()).then(() => closeDefaultSandbox()).catch(() => undefined);
    host?.closing?.(done);
  }
  // Two daemons in one process: the next host half replaces the first while the first daemon may still be running (its turns go on through the opener it built), so its opener is NOT closed here.
  // It is handed to the first host half as `retire`, which the seam wiring calls when that daemon stops without holding the seam any more; before, the opener was dropped here and never closed.
  else if (closeOpener && host && h !== host) {
    const old = host, close = closeOpener;
    old.retire = () => { const done = close().catch(() => undefined); old.closing?.(done); return done; };
  }
  closeOpener = null;
  host = h;
  building = null;
  bindRelay(h?.nodes ?? null);
  const root = h?.engines?.install ? enginesRoot({ dataDir: h.dataDir }) : null;
  const vm = root !== null && wslEngines(h);
  configureEngines(root !== null ? { root: vm ? path.join(root, "wsl") : root, ...(vm ? { platform: process.arch === "arm64" ? "linux-arm64-musl" as const : "linux-x64-musl" as const } : {}), ...(h?.log ? { log: h.log } : {}) } : null);
  if (h === null) { bindEngine(null); bindBridge(null); bindOpener(null); completer = null; compactor = null; bindStepOpen(null); bindModelLister(null); }
}

export function engineHost(): EngineHostSeam | null { return host; }

/** Windows with WSL on and no plan of the host's: CLI engines run in Vyre's WSL sandbox, so the engines Vyre installs and looks for are the Linux builds in <engines>\wsl. */
function wslEngines(h: EngineHostSeam | null): boolean {
  return h !== null && process.platform === "win32" && h.sandbox === undefined && h.cli?.probe === undefined && windowsMode() === "contained" && wslOn();
}
/** How CLI programs are looked for: the host's probe, or on Windows with the WSL sandbox only Vyre's Linux builds (a Windows claude.exe cannot run in the VM). */
function cliProbeOf(h: EngineHostSeam): NodeCliProbe | undefined {
  return h.cli?.probe ?? (wslEngines(h) ? { platform: "linux", env: { PATH: "" } } : undefined);
}

/** The sandbox plan plugin code runs in: the host's own, or the default for this platform. Rejects where nothing can confine it, and then nothing starts. */
export function sandboxPlan(): Promise<SandboxPlan> {
  const h = host;
  if (h?.sandbox) return Promise.resolve(h.sandbox);
  if (h?.dataDir) return defaultPlan(h.dataDir, cliRead(h))();
  return Promise.reject(new Error("no sandbox is set up on this computer"));
}

export async function resolveOne(h: Pick<EngineHostSeam, "call" | "log">, q: AccountQuery): Promise<ResolvedAccount | null> {
  const res = (await h.call("engine.account.resolve", { threadId: q.threadId, agentId: q.agentId, askerId: q.askerId, ...(q.stepKey ? { stepKey: q.stepKey } : {}), ...(q.unavailable?.length ? { unavailable: [...q.unavailable] } : {}), ...(q.kind ? { kind: q.kind } : {}) }, q.askerId)) as ResolveOut;
  if (!res.allowed || !res.accountRef || !res.payer) {
    h.log?.("no account can pay for this turn", { threadId: q.threadId, agentId: q.agentId, asker: q.askerId, allowed: res.allowed, reason: res.reason, accountRef: res.accountRef ?? null });
    return null;
  }
  const list = (await h.call("engine.accounts.list", {}, res.payer)) as { accounts: AccountRow[] };
  const row = list.accounts.find((a) => a.ref === res.accountRef);
  if (!row) { h.log?.("the account the turn resolved is not in the payer's list", { threadId: q.threadId, accountRef: res.accountRef, payer: res.payer }); return null; }   // the key vanished between the two calls: treat as none, the next turn asks again
  return { ref: row.ref, driver: row.driver, provider: providerOfDriver(row.driver), kind: row.kind, payer: res.payer, reason: res.reason, ...(row.mine ? {} : { shared: true }), ...(res.itemId ? { itemId: res.itemId } : {}), ...(res.fellBack ? { fellBack: true } : {}), ...(res.via ? { via: res.via } : {}), ...(res.cappedFrom ? { cappedFrom: res.cappedFrom } : {}), ...(row.base ? { base: row.base } : {}), ...(row.keyless ? { keyless: true } : {}), ...(row.spaceKey ? { spaceKey: true } : {}), ...(res.modelFallback ? { modelFallback: res.modelFallback } : {}) };
}

/** An account whose engine can run on this computer: the pick, or another account of the person when the pick's program is not installed (runnable-account.ts). */
function runnableAccount(h: EngineHostSeam): (q: AccountQuery) => Promise<ResolvedAccount | null> {
  // On a Space server a person's own account pays only while the server holds their key (locked-account.ts); the next account answers otherwise, said in the chat.
  // a team chat whose model no Space account serves runs on the account's default, said in one line (model-fallback.ts)
  const resolve = noteModelFallback({ resolve: skipLocked({ resolve: (q) => resolveOne(h, q), ...(h.keyHeld ? { held: h.keyHeld } : {}), ...(h.postAs ? { postAs: h.postAs } : {}), ...(h.log ? { log: h.log } : {}) }), ...(h.postAs ? { postAs: h.postAs } : {}), ...(h.log ? { log: h.log } : {}) });
  // A host that hands in its own opener (a test's scripted one) starts no program of ours: nothing to check, and one resolve per turn.
  if (h.openSession) return resolve;
  return createRunnableAccount({
    call: h.call, resolve, ...(h.cli?.command ? { command: h.cli.command } : {}), ...(cliProbeOf(h) ? { probe: cliProbeOf(h) as NodeCliProbe } : {}),
    ...(h.postAs ? { postAs: h.postAs } : {}), ...(h.log ? { log: h.log } : {}), ...(engines() ? { engines: engines()! } : {}),
    // the host's own sandbox plan decides where it gives one; otherwise this computer's (sandbox-default.ts)
    ...(h.sandbox ? {} : { unsandboxed: () => cliSandboxGap() }),
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

/** The Need behind a paid fallback: one per chat, agent and key. Marking it Done is the yes: the row it leaves lets the key answer here, and the agent carries on (wakeAfterUnblock). */
async function askToPay(h: EngineHostSeam, db: Db, q: AccountQuery, to: ResolvedAccount): Promise<void> {
  const list = (await h.call("engine.accounts.list", {}, to.payer)) as { accounts: Array<{ ref: string; name?: string; title?: string }> };
  const row = list.accounts.find((a) => a.ref === to.ref);
  const name = row?.name ?? row?.title ?? to.ref;
  const made = (await h.call("tasks.create", {
    kind: "unblock", title: `Use ${name}?`, summary: `The account this chat runs on is out for now. ${name} could answer, and it bills for what it uses. Mark this done to let it, for this chat.`,
    assigned: { kind: "person", id: q.askerId }, source: { kind: "chat", id: q.threadId }, idempotencyKey: `paid-fallback:${q.threadId}:${q.agentId}:${to.ref}`,
  }, q.askerId)) as { task?: { id?: string } };
  const taskId = made.task?.id;
  if (taskId) db.run("INSERT OR REPLACE INTO engine_unblock (task_id, thread_id, agent_id, asker, at, paid_ref) VALUES (?, ?, ?, ?, ?, ?)", taskId, q.threadId, q.agentId, q.askerId, (h.now ?? Date.now)(), to.ref);
}

/** The turn's usage against the spend limits, at what it really cost (turn-cost.ts): a sign-in is in its plan (0), an API key turn is the provider's price or the list price, an unknown price is 0. */
export function costMicrosOf(turn: Readonly<TurnRow>, account: ResolvedAccount | null): number {
  const i = turn.info;
  return costOf({
    model: turn.model ?? "", tokensIn: turn.tokensIn, tokensOut: turn.tokensOut,
    ...(account ? { driver: account.driver, provider: account.provider, accountKind: account.kind } : {}),
    ...(i?.cacheReadTokens !== undefined ? { cacheReadTokens: i.cacheReadTokens } : {}), ...(i?.cacheWriteTokens !== undefined ? { cacheWriteTokens: i.cacheWriteTokens } : {}),
    ...(i?.costUsd !== undefined ? { costUsd: i.costUsd } : {}),
  }).micros ?? 0;
}

async function meter(h: EngineHostSeam, turn: Readonly<TurnRow>, account: ResolvedAccount | null): Promise<void> {
  if (turn.tokensIn + turn.tokensOut === 0) return;
  await h.call("engine.turn.record_usage", { turnId: turn.id, tokensIn: turn.tokensIn, tokensOut: turn.tokensOut, costMicros: costMicrosOf(turn, account), ...(account?.itemId ? { itemId: account.itemId } : {}) }, turn.asker);
}

export interface CompleteIn { account: ResolvedAccount; system?: string; prompt: string; model?: string }
export interface CompleteOut { text: string; tokensIn: number; tokensOut: number }
let completer: ((i: CompleteIn) => Promise<CompleteOut>) | null = null;
let compactor: Compactor | null = null;
/** engine.compact's worker (compact.ts): the chat's engine compacts itself, or Vyre compacts for it. Null before the runtime exists. */
export const compactorOf = (): Compactor | null => compactor;
/** One request and one answer on an account, through the same opener the turn engine uses: for jobs that need a model but are not a chat (memory upkeep). Null before the runtime exists. */
export const completerOf = (): typeof completer => completer;

/** Run one turn of a pseudo-agent on the account and collect its text and token counts. */
async function oneShot(openSession: OpenSession, i: CompleteIn, now: () => number): Promise<CompleteOut> {
  const n = now();
  const threadId = `oneshot_${n.toString(36)}`;
  const agent = { id: "memory-upkeep", name: "Memory upkeep", mode: "lead" as const, ...(i.system ? { role: i.system } : {}), ...(i.model ? { model: i.model } : {}), accountRef: i.account.ref };
  // lean: the system prompt is the job's own, with no tools, MCP, settings, memory files or skills, so a learning pass on a CLI costs a few hundred tokens more than its prompt, not thousands
  const session = await openSession({ threadId, agent, asker: i.account.payer, turnId: `trn_${n.toString(36)}`, traceId: "0".repeat(32), account: i.account, tools: "none", lean: true });
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

/** The Space's internet setting as the wall's rule, read now (each engine process start): the setting's value through wallEgress, the one builder. */
export async function spaceRule(call: EngineHostSeam["call"]): Promise<EgressRule> {
  const out = (await call("settings.get", { key: EGRESS_SETTING })) as { row?: { value?: unknown } } | undefined;
  return wallEgress(egressPolicyOf(out?.row?.value)).rule;
}

/**
 * What a CLI engine may touch on files, asked as each engine process starts (owner ruling 3 Nov): on the person's own computer (their Personal Space, or a Space their computer hosts) the folders they
 * added to Vyre from it; anywhere else the Space's server rules (the work folder and the Space's toolbox). A Space that cannot be read is a server; folders that cannot be read are none.
 */
export async function engineAccessFor(call: EngineHostSeam["call"], asker: string): Promise<AccessAsked> {
  const out = (await call("spaces.get", {}, asker)) as { space?: { kind?: string; owner?: string; address?: { mode?: string } } } | undefined;
  const s = out?.space;
  const own = s !== undefined && s.owner === asker && (s.kind === "personal" || s.address?.mode === "device");
  if (!own) return { where: "server", folders: [] };
  const mounts = (await call("mounts.engine_folders", { person: asker }).catch(() => ({ folders: [] }))) as { folders?: Array<{ path?: unknown }> };
  return { where: "own", folders: (mounts.folders ?? []).map((f) => f.path).filter((p): p is string => typeof p === "string") };
}

let defaultBuilt: DefaultSandbox | null = null;
/** What the sandbox lets a CLI engine read besides the system: the host's extra folders and Vyre's engines folder, where an engine Vyre installed lives (it may be installed after the sandbox is built). */
function cliRead(h: EngineHostSeam): readonly string[] | undefined {
  const root = engines()?.root;
  const extra = [...(h.cli?.programRead ?? []), ...(root ? [root] : [])];
  return extra.length > 0 ? extra : undefined;
}

let defaultBuilding: Promise<DefaultSandbox> | null = null;
/** What the Windows sandbox is doing while a turn waits for it, in the words of the turn's live line. */
let windowsPhase: "import" | "start" = "start";
/** The default sandbox plan for this platform, built once per runtime (again after the Windows sandbox's VM stopped). */
export const defaultPlan = (dataDir: string, programRead?: readonly string[]) => async (): Promise<SandboxPlan> => {
  const p = defaultBuilding ??= defaultSandbox({ dataDir, ...(programRead ? { programRead } : {}), onPhase: (ph) => { windowsPhase = ph; } }).then((d) => {
    defaultBuilt = d;
    if (d.plan.sandbox.kind === "wsl") void d.plan.sandbox.agent.exited.then(() => { if (defaultBuilding === p) { defaultBuilding = null; defaultBuilt = null; } });
    return d;
  }, (e: unknown) => { defaultBuilding = null; throw e; });
  return (await p).plan;
};
/** The Windows sandbox, when it is not up yet: what to wait for and the live line's words. Null when it is up (or this is not Windows). */
function warmWindowsSandbox(dataDir: string, programRead?: readonly string[]): { ready: Promise<void>; words: () => string } | null {
  if (defaultBuilt !== null && defaultBuilding !== null) return null;
  return {
    ready: defaultPlan(dataDir, programRead)().then(() => undefined),
    words: () => (windowsPhase === "import" ? "Setting up the Windows sandbox, once: this takes a few minutes" : "Starting the Windows sandbox, first turn after a restart"),
  };
}
/** Stop the default sandbox's wall (daemon shutdown, tests). */
export async function closeDefaultSandbox(): Promise<void> { const d = defaultBuilt; defaultBuilt = null; defaultBuilding = null; await d?.close(); }

/**
 * Build and bind the runtime, once, on this module's database; then recover threads a dead host left with work queued or running. Returns null when no host half is configured
 * (a daemon without the engine seam, or a unit test), in which case the control handlers keep raising internal.unavailable.
 */
export function ensureRuntime(ctx: Pick<EngineCtx, "db">): Promise<TurnEngine | null> {
  // Built and bound only on the database of the daemon this host half belongs to. Where two daemons share the process (the two-computer tests), the other's periodic job or consumer reached here too and
  // built the runtime on its own database with this host half; when that daemon stopped, its database closed under the runtime and every message after it failed ("database is not open").
  // The check comes first so that daemon binds nothing, the MCP sign-in store included.
  if (host?.ours && !host.ours(ctx.db)) return Promise.resolve(null);
  bindOauthStore(ctx as never);   // the sealed MCP sign-in tokens are read through the module's own ctx (db, seal, clock)
  if (!host || (!host.openSession && !host.session)) return Promise.resolve(null);   // no way to open a session: the control handlers keep answering internal.unavailable
  // One runtime per host: every call after the first answers with it. The opener below is part of it; building another on each call left the first one, the one with the live CLI sessions, unreachable
  // for closeOpener, so Quit closed an empty pool and the engine process, its MCP socket and its egress proxy outlived the daemon.
  if (building) return building;
  const h = host;
  const apiTools = host.invoke && host.space ? createEngineApiTools({ invoke: host.invoke, space: host.space, system: roleBlocks(h.call), call: h.call, plugins: createPluginTools({ call: h.call, runtime: pluginRuntime, ...(h.log ? { log: h.log } : {}) }) }) : undefined;
  const now0 = h.now ?? Date.now;
  // a CLI engine's own session id, kept per chat, agent and person so a restart or an eviction resumes it; and the chat's "Keep this every time" for the CLI's own compaction
  const sessions = {
    resume: (k: { threadId: string; agentId: string; person: string; driver: string; tools?: "none" }) => (keepsSession(k) ? resumeId(ctx.db, k) : null),
    checkpoint: (k: { threadId: string; agentId: string; person: string; driver: string; tools?: "none" }, id: string | null) => { if (keepsSession(k)) saveResumeId(ctx.db, k, id, now0()); },
    keep: (threadId: string) => keepEvery(ctx.db, threadId),
  };
  // the Space's internet setting, read as each engine process starts, and where the process went (the turn's details, and the audit log for a refusal)
  const egress = { rule: () => spaceRule(h.call), record: (where: { person: string; threadId: string }, e: Parameters<typeof recordEgress>[3]) => recordEgress(ctx.db, h.call, where, e, now0, h.log) };
  const access = (asker: string) => engineAccessFor(h.call, asker);
  const opener = host.openSession ? null : buildOpener({ sessions, egress, access, ...(h.own ? { own: h.own } : {}), ...(apiTools ? { apiTools } : {}), session: host.session as EngineSessionPorts, call: h.call, ...(host.sandbox ? { sandbox: host.sandbox } : {}), ...(host.cli?.command ? { cliCommand: host.cli.command } : {}), ...(cliProbeOf(host) ? { cliProbe: cliProbeOf(host) as NodeCliProbe } : {}), ...(host.cli?.apiFetch ? { apiFetch: host.cli.apiFetch } : {}), ...(host.dataDir ? { dataDir: host.dataDir, defaultSandbox: defaultPlan(host.dataDir, cliRead(host)) } : {}) });
  // the composer's model menu asks each subscription engine for its own list, through this opener: the person's sandbox and sign-in, as a turn would run (live-models.ts)
  bindModelLister(opener ? (account, asker, o) => opener.models(account, asker, o) : null);
  // a turn whose engine Vyre is installing says so on its live line ("Setting up Codex"); the line is the bridge's, which exists once the runtime is built below
  let setupLine: ((e: StreamEvent) => void) | null = null;
  const installer = engines();
  const dataDir0 = host.dataDir;
  const read0 = cliRead(host);
  const baseOpen = host.openSession ?? checkedOpen((opener as NonNullable<typeof opener>).openSession, {
    ...(host.cli?.command ? { command: host.cli.command } : {}), ...(cliProbeOf(host) ? { probe: cliProbeOf(host) as NodeCliProbe } : {}), ...(installer ? { engines: installer } : {}),
    ...(host.sandbox ? {} : { unsandboxed: () => cliSandboxGap(), unsandboxedCode: () => cliSandboxCode() }),
    // the Windows sandbox's first start after a restart (or its one-time set-up) is a live line, not a silent wait
    ...(process.platform === "win32" && windowsMode() === "contained" && !host.sandbox && dataDir0 ? { warm: () => warmWindowsSandbox(dataDir0, read0) } : {}),
    live: (e) => setupLine?.(e),
  });
  // a turn the person pinned to one of their servers opens through that server's opener; everything else opens as before
  const nodeOpeners = new Map<string, ReturnType<typeof buildNodeOpener>>();
  // a test's stand-in network for the API drivers (engineCli.apiFetch) reaches a turn on one of the person's servers too, as it does a turn on the Space; absent, the real network
  const openerHost = { ...(h.own ? { own: h.own } : {}), ...(apiTools ? { apiTools } : {}), ...(host.cli?.apiFetch ? { apiFetch: host.cli.apiFetch } : {}), session: host.session as EngineSessionPorts, call: h.call, egress: { rule: egress.rule }, access };
  // a person's own computer (node device:<id>): their turns only, and the engine there works in the folders they added to Vyre from that computer (mounts.engine_folders, lane l-openweb's list)
  const deviceFolders = (person: string, deviceId: string) => async (): Promise<string[]> => {
    const out = (await h.call("mounts.engine_folders", { person }).catch(() => ({ folders: [] }))) as { folders?: Array<{ path?: unknown; deviceId?: unknown }> };
    return (out.folders ?? []).filter((f) => f.deviceId === deviceId && typeof f.path === "string").map((f) => f.path as string);
  };
  const nodeOpener = (nodeId: string, person?: string) => {
    const key = person === undefined ? nodeId : `${nodeId}\u0000${person}`;
    let o = nodeOpeners.get(key);
    if (!o) {
      const device = nodeId.startsWith("device:") && person !== undefined ? nodeId.slice(7) : null;
      o = buildNodeOpener(device ? { ...openerHost, folders: deviceFolders(person!, device) } : openerHost, remoteLauncher(h.nodes as NodeRelay, nodeId, person));
      nodeOpeners.set(key, o);
    }
    return o.openSession;
  };
  // the Space's own server, as a line says it ("continuing on the Northwind server"); a Personal Space is the person's computer
  let spaceLine: Promise<string> | null = null;
  const spaceName = (): Promise<string> => (spaceLine ??= (h.call("spaces.get", {}) as Promise<{ space?: { name?: string; kind?: string } }>).then((r) => (r.space?.kind === "personal" ? "this computer" : r.space?.name ? `the ${r.space.name} server` : "the Space's server")).catch(() => { spaceLine = null; return "the Space's server"; }));
  const serverName = async (serverId: string, person: string): Promise<string | undefined> => (((await h.call("network.my_computers", {}, person)) as { computers?: Array<{ serverId: string; name: string }> }).computers ?? []).find((x) => x.serverId === serverId)?.name;
  // a line in the chat from the agent whose turn it is, as the bridge posts its own (a turn_status block)
  const noteLine = (agentId: string, actingFor: string, threadId: string, data: Record<string, unknown>): void => {
    if (!h.postAs) return;
    void Promise.resolve(h.postAs(agentId, { actingFor, threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintEngineId("b", now0()).slice(2), blocks: [{ type: "turn_status", v: 1, data }] }))
      .catch((e: unknown) => h.log?.("a line about where a chat runs was not posted", { threadId, error: e instanceof Error ? e.message : String(e) }));
  };
  const openSession = host.session && h.nodes && !host.openSession ? routed(baseOpen, {
    call: h.call, relay: h.nodes, nodeOpener, db: ctx.db, now: now0, spaceName, serverName,
    note: (spec, text) => noteLine(spec.agent.id, spec.asker, spec.threadId, text === SLEPT_WAIT_LINE ? { state: "device_wait", text, threadId: spec.threadId } : { state: "note", text }),
    live: (spec, phase) => setupLine?.({ kind: "step", threadId: spec.threadId, turnId: spec.turnId, agentId: spec.agent.id, phase, id: `${DEVICE_WAIT_STEP}_${spec.turnId}`, name: DEVICE_WAIT_STEP, ...(phase === "result" ? { ok: true } : {}) }),
  }) : baseOpen;
  // a Claude Code or Codex chat gets the agent's skills in its own work folder (person/thread/agent) before every turn, so one added mid-chat reaches a running engine (the opener wrote them as it started)
  const skillsDir = host.sandbox?.dataDir ?? host.dataDir;
  const nativeSkills = (o: OpenSession): OpenSession => (!host.openSession && skillsDir ? withNativeSkills(o, { call: h.call, workOf: (spec) => workFolder(skillsDir, spec.asker, spec.threadId, spec.agent.id), ...(h.log ? { log: h.log } : {}) }) : o);
  closeOpener = opener ? async () => { await opener.close(); await Promise.all([...nodeOpeners.values()].map((o) => o.close())); } : null;
  building ??= (async () => {
    const now = h.now ?? Date.now;
    const crewWatch = h.postAs ? createCrewWatcher({ db: ctx.db, host: h, now }) : null;
    const live = h.stream ? coalesceLive(h.stream, { now }) : null;
    setupLine = live;
    // the chat message a turn's reply became, so the reply's Details find its turn (chat.reply_details); a reply without its turn only loses its Details, never the post
    const linkPosted = (e: { threadId: string; turnId: string; messageId: string | null }): void => {
      try { if (e.messageId) linkReply(ctx.db, { threadId: e.threadId, turnId: e.turnId, messageId: e.messageId }, now()); }
      catch (err) { h.log?.("a reply could not be linked to its turn", { turnId: e.turnId, error: err instanceof Error ? err.message : String(err) }); }
    };
    const bridge = h.postAs ? createBridge({ postAs: h.postAs, now, stream: (e) => { if (e.kind === "final" && e.messageId) linkPosted(e); live?.(e); crewWatch?.(e); }, addressAsker: (threadId, agentId) => { const r = reviewerOf(ctx.db, threadId); return r?.kind === "agent" && r.id === agentId; }, ...(h.log ? { log: { warn: h.log } } : {}), callAs: (cap, input, person) => h.call(cap, input, person) }) : null;
    // The turn context is built as the asker before each turn (modules/engine/context.ts); what the agent waits on is read off the engine once it exists.
    let running: TurnEngine | null = null;
    const turnContext = createContextBuilder({
      call: h.call, skills: h.skills ?? capabilitySkills(h.call), now, handoff: takeHandoff,
      waiting: (threadId, agentId) => (running?.waiting(threadId) ?? []).filter((w) => w.agentId === agentId).map((w) => `an answer to task ${w.taskId} (a held call needs approval)`),
    });
    const limitSwitch = createLimitSwitch({
      call: h.call, accountFor: runnableAccount(h), now, ...(h.postAs ? { postAs: h.postAs } : {}), ...(h.log ? { log: h.log } : {}),
      paidOk: (q, ref) => ctx.db.all("SELECT 1 AS x FROM engine_paid_ok WHERE thread_id = ? AND agent_id = ? AND ref = ?", q.threadId, q.agentId, ref).length > 0,
      askToPay: (q, to) => askToPay(h, ctx.db, q, to),
      modelOf: (threadId, agentId) => { try { return running?.agents(threadId).find((a) => a.id === agentId)?.model; } catch { return undefined; } },
      providerOf: async (ref, payer) => {
        const list = (await h.call("engine.accounts.list", {}, payer)) as { accounts: Array<{ ref: string; driver: string }> };
        const row = list.accounts.find((a) => a.ref === ref);
        return row ? providerOfDriver(row.driver) : undefined;
      },
    });
    const engine = createTurnEngine({
      holder: h.holder, openSession: withHeldNotes(withChatSettings(withSpaceKeyTurns(withTurnContext(nativeSkills(withCompaction(withTranscript(withRecall(withAudienceReset(bridge ? bridge.tap(openSession) : openSession, { db: ctx.db, call: h.call, now, ...(opener ? { drop: (threadId: string) => opener.pool.drop(threadId) } : {}), ...(h.log ? { log: h.log } : {}) }), h.call), h.call, now), ctx.db)), turnContext), { call: h.call, db: ctx.db, now }), h.call)), now,
      queue: sqlQueue(ctx.db), leases: sqlLeases(ctx.db), messages: sqlMessages(ctx.db, now), waits: sqlWaits(ctx.db), newId: (p) => mintEngineId(p, now()),
      admit: (q) => admission(h, q),
      lostTurn: (row) => lostTurnId(ctx.db, row, () => mintEngineId("trn", now())),
      resolveAccount: (q) => limitSwitch.resolve(q),
      nextAccount: (q) => limitSwitch.next(q),
      onNoAccount: async (info) => {
        try { await unblock(h, ctx.db, info); }
        catch (e) { h.log?.("could not open the Unblock task for a turn with no account", { threadId: info.threadId, asker: info.asker, error: e instanceof Error ? e.message : String(e) }); throw e; }
      },
      // memory learns from the turn in the background (learn.ts): scheduled here, never awaited, so the reply is not held for it
      onTurnEnd: (turn, account) => { learnAfterTurn(h, turn, account); return meter(h, turn, account); },
      onLimits: (account, reading) => recordAccountLimits(ctx.db, account.ref, reading, now()),
      // the answer check (gap 6): an answer built on something not everyone in the chat may open goes to the asker privately
      ...(h.mayAll ? {
        screenAnswer: async (q: { threadId: string; turnId: string; agentId: string; asker: string; reply: string }) => {
          const s = await screenAnswer({ call: h.call, mayAll: h.mayAll!, ...(h.postAs ? { postAs: (agentId, post) => h.postAs!(agentId, post as never) } : {}), newId: () => BRIDGE_PREFIX + mintEngineId("b", now()).slice(2) }, q)
            .catch((e: unknown) => { settleAnswer(q.turnId, { body: ANSWER_HELD, withheld: true }); throw e; });
          settleAnswer(q.turnId, s);
          if (s.withheld) h.log?.("an answer went to its asker privately", { threadId: q.threadId, turnId: q.turnId, agentId: q.agentId, closed: s.closed.map((r) => `${r.type}:${r.id ?? ""}`).slice(0, 20) });
          return s;
        },
      } : {}),
      ...(apiTools ? { callTool: apiTools.runner } : {}),
      // a chat pinned to a computer that is not linked waits in the queue for it: the turn does not start (nothing reads "Working"), the chat says so once, and it starts when the computer links
      ...(h.nodes?.devices ? { place: (thread: { id: string }) => (waitsForComputer(ctx.db, h.nodes, thread.id) ? "device" as const : "host" as const) } : {}),
    });
    running = engine;
    // The reviewer seat: after a lead turn completes, the chat's reviewer is asked to check it.
    // Every turn this engine runs is reported to engine.turn.record under the engine's own id, in order per turn, so the turn list, review sampling and the agent's Working status see it.
    const recording = new Map<string, Promise<void>>();
    const report = (turnId: string, ev: Extract<EngineEvent, { type: "turn.started" | "turn.completed" | "turn.failed" | "turn.cancelled" }>): void => {
      const turn = engine.turns().find((t) => t.id === turnId);
      if (!turn) return;
      const phase = ev.type === "turn.started" ? "started" : ev.type === "turn.completed" ? "completed" : ev.type === "turn.failed" ? "failed" : "cancelled";
      const input = {
        threadId: turn.threadId, turnId, agentId: turn.agentId, phase, qseq: turn.qseq, asker: turn.asker, ...(turn.model ? { model: turn.model } : {}),
        ...(phase === "started" ? {} : { tokensIn: turn.tokensIn, tokensOut: turn.tokensOut }),
        // what the reply's Details show: the engine and account it ended on, and what the turn engine saw (reply-info.ts)
        ...(phase !== "started" && turn.info ? { info: turn.info, ...(turn.info.account ? { engine: turn.info.account.driver, accountRef: turn.info.account.ref } : {}) } : {}), ...(ev.type === "turn.failed" ? { code: ev.code, ...(ev.message ? { message: ev.message.slice(0, 500) } : {}) } : {}),
      };
      const done = (recording.get(turnId) ?? Promise.resolve()).then(() => h.call("engine.turn.record", input, turn.asker)).then(() => undefined, (err: unknown) => {
        h.log?.("a turn could not be recorded", { turnId, phase, error: err instanceof Error ? err.message : String(err) });
      });
      recording.set(turnId, done);
      if (phase !== "started") void done.then(() => { if (recording.get(turnId) === done) recording.delete(turnId); });
    };
    // the chats waiting for a computer, so the line is said once per wait and the right ones start when a computer links
    const waitingFor = new Set<string>();
    h.nodes?.onDevice?.((link, up) => {
      if (!up || link.engines.length === 0) return;
      for (const threadId of [...waitingFor]) {
        if (waitsForComputer(ctx.db, h.nodes, threadId)) continue;
        waitingFor.delete(threadId);
        try { engine.kick(threadId); } catch { /* not open here any more: its next message opens it */ }
      }
    });
    engine.subscribe((ev) => {
      if (ev.type === "agent.handoff" && ev.to === "device") {
        if (waitingFor.has(ev.threadId)) return;
        waitingFor.add(ev.threadId);
        const row = engine.queue(ev.threadId).find((q) => q.state === "queued");
        if (row) noteLine(row.agentId, row.from.startsWith("usr_") ? row.from : (waitsForComputer(ctx.db, h.nodes, ev.threadId)?.person ?? row.from), ev.threadId, { state: "device_wait", text: DEVICE_WAIT_LINE, threadId: ev.threadId });
        return;
      }
      if (ev.type === "turn.started") waitingFor.delete(ev.threadId);
      // a message for an agent that runs outside Vyre waits in its queue: the owner's only, the queue checks that
      if (ev.type === "agent.outside_asked") {
        void h.call("agents.outside.enqueue", { agentId: ev.agentId, kind: "mention", threadId: ev.threadId, messageId: ev.messageId, asker: ev.asker, title: "A message for you", text: ev.body })
          .catch((err: unknown) => h.log?.("a message for an outside agent was not queued", { threadId: ev.threadId, error: err instanceof Error ? err.message : String(err) }));
        return;
      }
      if (ev.type === "turn.started") { awake.up(); clearReads(ev.threadId, ev.agentId, ev.asker); h.turns?.(awake.running()); }
      else if (ev.type === "turn.completed" || ev.type === "turn.cancelled" || (ev.type === "turn.failed" && ev.code !== "host_lost") || (ev.type === "turn.waiting" && ev.reason === "approval")) { awake.down(); h.turns?.(awake.running()); }
      // a turn a dead host left is not in this engine's rows: its record is closed from what recover() knows, so the turn list, Try again and the agent's Working status are right
      if (ev.type === "turn.failed" && ev.code === "host_lost") {
        void h.call("engine.turn.record", { threadId: ev.threadId, turnId: ev.turnId, agentId: ev.agentId, phase: "failed", qseq: ev.qseq ?? 0, ...(ev.asker ? { asker: ev.asker } : {}), code: ev.code }, ev.asker)
          .catch((err: unknown) => h.log?.("a lost turn could not be recorded", { turnId: ev.turnId, error: err instanceof Error ? err.message : String(err) }));
      }
      else if (ev.type === "turn.started" || ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "turn.cancelled") report(ev.turnId, ev);
      if (ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "turn.cancelled") {
        // a routine's run ends with the turn it woke (handlers/routine-run.ts)
        void finishRoutineRun(ctx, { call: h.call, ...(h.log ? { log: h.log } : {}) }, ev as Parameters<typeof finishRoutineRun>[2], (id) => engine.turns().find((t) => t.id === id)?.qseq)
          .catch((err) => h.log?.("a routine run was not finished", { threadId: ev.threadId, error: err instanceof Error ? err.message : String(err) }));
        void onTurnEnded(ctx, { call: h.call, now, ...(h.log ? { log: h.log } : {}) }, engine, ev).catch((err) => h.log?.("a task baton check failed", { threadId: ev.threadId, error: err instanceof Error ? err.message : String(err) }));
      }
      if (ev.type !== "turn.completed") return;
      void reviewAfter({ call: h.call, ...(h.postAs ? { postAs: h.postAs } : {}) }, ctx.db, engine, ev, () => mintEngineId("msg", now())).catch((err) => h.log?.("the reviewer could not be asked", { threadId: ev.threadId, error: err instanceof Error ? err.message : String(err) }));
    });
    bridge?.attach(engine);
    h.extend?.(engine);
    completer = (i) => oneShot(openSession, i, now);
    compactor = createCompactor({
      db: ctx.db, call: h.call, engine: () => running, resolve: (q) => resolveOne(h, q), open: openSession, now,
      ...(opener ? { dropSessions: (threadId: string) => opener.pool.drop(threadId) } : {}), ...(h.postAs ? { postAs: h.postAs } : {}), ...(h.log ? { log: h.log } : {}),
    });
    bindEngine(engine);
    bindOpener(opener);
    bindStepOpen(openSession);
    bindBridge(bridge);
    // threads with work a dead host left: queued or running rows with no live lease
    await recoverStale(ctx, engine, ["queued", "running"]);
    void closeNoAccountTasks(ctx.db).catch((e) => h.log?.("the no-account sweep failed", { error: e instanceof Error ? e.message : String(e) }));
    // the tasks agents hold pick up from their own state after a restart
    void resumeTasks(ctx, { call: h.call, ...(h.log ? { log: h.log } : {}) }, engine).catch((e) => h.log?.("tasks could not be picked up after a restart", { error: e instanceof Error ? e.message : String(e) }));
    return engine;
  })().catch((e) => { building = null; throw e; });
  return building;
}

/**
 * Threads with work a dead host left: rows still marked running (or queued) whose lease nobody beats any more. At boot this runs once, but a restart inside the lease's 20 seconds finds the dead host's lease still
 * alive and recover() answers false, so the sweep runs again from the periodic job until the lease has run out. A turn this host is running keeps its own lease, so it is never touched.
 */
export async function recoverStale(ctx: Pick<EngineCtx, "db">, engine: TurnEngine, states: readonly string[] = ["running"]): Promise<void> {
  const stale = ctx.db.all(`SELECT thread_id, MIN(from_principal) AS person FROM engine_thread_queue WHERE state IN (${states.map(() => "?").join(", ")}) GROUP BY thread_id`, ...states) as Array<{ thread_id: string; person: string }>;
  for (const r of stale) {
    try {
      await open(ctx as EngineCtx, r.thread_id, asPerson(ctx.db, r.thread_id, r.person));
      engine.recover(r.thread_id);
    } catch { /* a thread that cannot be opened now is opened by its next message */ }
  }
}

/** Who a job of the host reads a thread as. A private chat answers only to its people, so the host asks as the person the work was for, else the person whose turn ran there last. */
function asPerson(db: Db, threadId: string, hint: string | undefined): ((threadId: string) => Promise<unknown>) | undefined {
  const h = host;
  if (!h) return undefined;
  ensureExtra(db);
  const person = hint?.startsWith("usr_") ? hint : (db.all("SELECT asker FROM engine_turns WHERE thread_id = ? AND asker LIKE 'usr%' ORDER BY started_at DESC LIMIT 1", threadId) as Array<{ asker?: string }>)[0]?.asker;
  return person ? (id) => h.call("threads.get", { threadId: id }, person) : undefined;
}

/** Open a thread for a job of the host, read as the person it is for. */
export const openAs = (ctx: EngineCtx, threadId: string, person: string): Promise<TurnEngine> => open(ctx, threadId, asPerson(ctx.db, threadId, person));

/** Make sure the thread a parked turn waits in is open on this host. */
export async function openFor(ctx: EngineCtx, taskId: string): Promise<void> {
  const w = (ctx.db.all("SELECT thread_id, asker FROM engine_waits WHERE task_id = ?", taskId) as Array<{ thread_id: string; asker: string }>)[0];
  if (w) await open(ctx, w.thread_id, asPerson(ctx.db, w.thread_id, w.asker));
}

/** The record a queue row's turn has, else a new id for one: recover() needs one id to say everything about a lost turn under. */
export function lostTurnId(db: Db, row: { threadId: string; qseq: number }, mint: () => string): string {
  ensureExtra(db);
  const r = (db.all("SELECT turn_id FROM engine_turns WHERE thread_id = ? AND qseq = ? ORDER BY started_at DESC LIMIT 1", row.threadId, row.qseq) as Array<{ turn_id: string }>)[0];
  return r?.turn_id ?? mint();
}

/** A paused agent takes no turn and a deleted one is gone. What the agents module answers decides; if it cannot answer, the turn goes on. */
async function admission(h: EngineHostSeam, q: { threadId: string; agentId: string; asker: string }): Promise<{ code: string; message: string } | null> {
  let status: { status?: string; reason?: string };
  try { status = (await h.call("agents.status", { agentId: q.agentId }, q.asker)) as { status?: string; reason?: string }; }
  catch (e) {
    const code = (e as { error?: { code?: string } } | null)?.error?.code;
    return code === "validation.not_found" ? { code: "agent_gone", message: "That agent is not here any more." } : null;
  }
  return status.status === "paused" ? { code: "agent_paused", message: status.reason ?? "This agent is paused." } : null;
}

/** The person answered an Unblock (the task is done): wake the agent that had no account, in the same thread. */
export async function wakeAfterUnblock(ctx: EngineCtx, taskId: string): Promise<boolean> {
  const row = (ctx.db.all("SELECT thread_id, agent_id, asker, paid_ref FROM engine_unblock WHERE task_id = ?", taskId) as Array<{ thread_id: string; agent_id: string; asker: string; paid_ref: string | null }>)[0];
  if (!row) return false;
  const asker = row.asker;
  ctx.db.run("DELETE FROM engine_unblock WHERE task_id = ?", taskId);
  if (row.paid_ref) ctx.db.run("INSERT OR REPLACE INTO engine_paid_ok (thread_id, agent_id, ref, by_person, at) VALUES (?, ?, ?, ?, ?)", row.thread_id, row.agent_id, row.paid_ref, asker, ctx.now());
  const engine = await ensureRuntime(ctx);
  if (!engine) return false;
  await open(ctx, row.thread_id, asPerson(ctx.db, row.thread_id, asker));
  engine.wake(row.thread_id, row.agent_id);
  return true;
}
