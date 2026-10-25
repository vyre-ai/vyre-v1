// The engine runtime on a booted daemon (P-L2_23): built the first time a handler or the periodic job runs with the module's database, bound so the control handlers reach it, and told
// to recover the threads a dead host left mid-turn. Everything it needs from outside arrives through `EngineHostSeam` (host/src/seams/engine.ts): a way to call capabilities as a
// person, and the opener of real sessions. The turn engine itself stays in agent/src/turn-engine and knows nothing about modules.
import { createTurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { TurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { AccountQuery, OpenSession, ResolvedAccount, TurnRow } from "../../agent/src/turn-engine/types.ts";
import { open } from "./handlers/control.ts";
import { bindBridge, createBridge } from "./handlers/bridge.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import { createEngineApiTools } from "./api-tools.ts";
import { buildOpener, roleBlocks } from "./session.ts";
import { defaultSandbox } from "./sandbox-default.ts";
import type { DefaultSandbox } from "./sandbox-default.ts";
import type { SandboxPlan } from "./sandbox.ts";
import type { EngineSessionPorts } from "./session.ts";
import type { PostAs } from "./handlers/bridge.ts";
import { bindEngine, bindOpener, mintEngineId, sqlLeases, sqlMessages, sqlQueue, sqlWaits } from "./projections.ts";
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
  /** CLI engines: swap a program for a command (a fake CLI in a test), and extra read-only folders the sandbox must expose for it. Default: the real CLI, nothing extra. */
  cli?: { command?: Readonly<Record<string, readonly string[]>>; programRead?: readonly string[] };
  /** The Space data directory. With it and no `sandbox`, the module builds the default sandbox for this platform on the first CLI turn (sandbox-default.ts). */
  dataDir?: string;
  now?: () => number;
  /** Run chat.post as an agent (the host builds the call with the agent as principal). With it the chat bridge is attached: the engine's replies become chat posts. */
  postAs?: PostAs;
  /** Runs once the runtime exists and before it is bound (the chat bridge attaches here). */
  extend?: (engine: TurnEngine) => void;
}

interface AccountRow { ref: string; driver: string; kind: "api_key" | "subscription" }
interface ResolveOut { accountRef: string | null; payer: string | null; reason: ResolvedAccount["reason"]; allowed: boolean; itemId?: string }

/** The provider a driver belongs to, for the session spec; the CLI engines run their vendor's models. */
const PROVIDER_OF_DRIVER: Readonly<Record<string, string>> = Object.freeze({ claude_code: "anthropic", codex: "openai", grok: "xai" });
export const providerOfDriver = (driver: string): string => PROVIDER_OF_DRIVER[driver] ?? driver;

let host: EngineHostSeam | null = null;
let building: Promise<TurnEngine | null> | null = null;
let closeOpener: (() => Promise<void>) | null = null;

/** The module's seam: the daemon calls this at boot with the host half (null at shutdown). */
export function setEngineHost(h: EngineHostSeam | null): void {
  if (h === null && closeOpener) void closeOpener().catch(() => undefined);   // processes end and MCP tokens are revoked at shutdown
  closeOpener = null;
  host = h;
  building = null;
  if (h === null) { bindEngine(null); bindBridge(null); bindOpener(null); }
}

export function engineHost(): EngineHostSeam | null { return host; }

async function accountFor(h: EngineHostSeam, q: AccountQuery): Promise<ResolvedAccount | null> {
  const res = (await h.call("engine.account.resolve", { threadId: q.threadId, agentId: q.agentId, askerId: q.askerId, ...(q.stepKey ? { stepKey: q.stepKey } : {}) }, q.askerId)) as ResolveOut;
  if (!res.allowed || !res.accountRef || !res.payer) return null;
  const list = (await h.call("engine.accounts.list", {}, res.payer)) as { accounts: AccountRow[] };
  const row = list.accounts.find((a) => a.ref === res.accountRef);
  if (!row) return null;   // the key vanished between the two calls: treat as none, the next turn asks again
  return { ref: row.ref, driver: row.driver, provider: providerOfDriver(row.driver), kind: row.kind, payer: res.payer, reason: res.reason, ...(res.itemId ? { itemId: res.itemId } : {}) };
}

async function unblock(h: EngineHostSeam, db: Db, info: { threadId: string; turnId: string; agentId: string; asker: string }): Promise<void> {
  const key = `no-account:${info.threadId}:${info.agentId}:${info.asker}`;
  const made = (await h.call("tasks.create", {
    kind: "unblock", title: "Add a key so your agent can answer", summary: "No API key or sign-in is available to run this conversation. Add one in the Vault and the agent answers.",
    assigned: { kind: "person", id: info.asker }, source: { kind: "engine", id: info.turnId }, idempotencyKey: key,
  }, info.asker)) as { task?: { id?: string } };
  const taskId = made.task?.id;
  if (taskId) db.run("INSERT OR REPLACE INTO engine_unblock (task_id, thread_id, agent_id, asker, at) VALUES (?, ?, ?, ?, ?)", taskId, info.threadId, info.agentId, info.asker, (h.now ?? Date.now)());
}

async function meter(h: EngineHostSeam, turn: Readonly<TurnRow>, account: ResolvedAccount | null): Promise<void> {
  if (turn.tokensIn + turn.tokensOut === 0) return;
  await h.call("engine.turn.record_usage", { turnId: turn.id, tokensIn: turn.tokensIn, tokensOut: turn.tokensOut, costMicros: 0, ...(account?.itemId ? { itemId: account.itemId } : {}) }, turn.asker);
}

let defaultBuilt: DefaultSandbox | null = null;
/** The default sandbox plan for this platform, built once per runtime. */
const defaultPlan = (dataDir: string, programRead?: readonly string[]) => async (): Promise<SandboxPlan> => (defaultBuilt ??= await defaultSandbox({ dataDir, ...(programRead ? { programRead } : {}) })).plan;
/** Stop the default sandbox's wall (daemon shutdown, tests). */
export async function closeDefaultSandbox(): Promise<void> { const d = defaultBuilt; defaultBuilt = null; await d?.close(); }

/**
 * Build and bind the runtime, once, on this module's database; then recover threads a dead host left with work queued or running. Returns null when no host half is configured
 * (a daemon without the engine seam, or a unit test), in which case the control handlers keep raising internal.unavailable.
 */
export function ensureRuntime(ctx: Pick<EngineCtx, "db">): Promise<TurnEngine | null> {
  if (!host || (!host.openSession && !host.session)) return Promise.resolve(null);   // no way to open a session: the control handlers keep answering internal.unavailable
  const h = host;
  const apiTools = host.invoke && host.space ? createEngineApiTools({ invoke: host.invoke, space: host.space, system: roleBlocks(h.call) }) : undefined;
  const opener = host.openSession ? null : buildOpener({ ...(apiTools ? { apiTools } : {}), session: host.session as EngineSessionPorts, call: h.call, ...(host.sandbox ? { sandbox: host.sandbox } : {}), ...(host.cli?.command ? { cliCommand: host.cli.command } : {}), ...(host.dataDir ? { dataDir: host.dataDir, defaultSandbox: defaultPlan(host.dataDir, host.cli?.programRead) } : {}) });
  const openSession = host.openSession ?? (opener as NonNullable<typeof opener>).openSession;
  closeOpener = opener ? () => opener.close() : null;
  building ??= (async () => {
    const now = h.now ?? Date.now;
    const bridge = h.postAs ? createBridge({ postAs: h.postAs, now }) : null;
    const engine = createTurnEngine({
      holder: h.holder, openSession: bridge ? bridge.tap(openSession) : openSession, now,
      queue: sqlQueue(ctx.db), leases: sqlLeases(ctx.db), messages: sqlMessages(ctx.db, now), waits: sqlWaits(ctx.db), newId: (p) => mintEngineId(p, now()),
      resolveAccount: (q) => accountFor(h, q),
      onNoAccount: (info) => unblock(h, ctx.db, info),
      onTurnEnd: (turn, account) => meter(h, turn, account),
      ...(apiTools ? { callTool: apiTools.runner } : {}),
    });
    bridge?.attach(engine);
    h.extend?.(engine);
    bindEngine(engine);
    bindOpener(opener);
    bindBridge(bridge);
    // threads with work a dead host left: queued or running rows with no live lease
    const stale = ctx.db.all("SELECT DISTINCT thread_id FROM engine_thread_queue WHERE state IN ('queued', 'running')") as Array<{ thread_id: string }>;
    for (const r of stale) {
      try {
        await open(ctx as EngineCtx, r.thread_id);
        engine.recover(r.thread_id);
      } catch { /* a thread that cannot be opened now is opened by its next message */ }
    }
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
