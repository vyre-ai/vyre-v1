// Placement, the warm pool and the warm hint as capabilities (P-L2_04's logic, wrapped; no new pool or placement logic here):
//   engine.placement.decide  agent/src/placement placeTurn: host, the asker's computer, or wait.
//   engine.pool.status       the pool the session opener keeps (agent/src/pool): sessions per driver, hits and misses.
//   engine.warm              agent/src/pool warmHint through the opener: start the engine ahead of the first message; answers at once.
import { placeTurn } from "../../../agent/src/placement/index.ts";
import type { PlaceDevice, PlaceInput } from "../../../agent/src/placement/index.ts";
import type { ResolvedAccount, SessionSpec, ThreadKind } from "../../../agent/src/turn-engine/types.ts";
import { flagOn } from "./extra/config.ts";
import { ensure, mintEngineId, openerOf, raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
interface CallCtx extends EngineCtx { call(cap: string, input: unknown): Promise<unknown> }

// DECISION: a device's role comes from its class. Desktop apps and daemons are daemons (they run CLI engines); phones, browsers and extensions are clients (they run none), so their private chats run on the Space.
// DECISION: a device is online when the server heard from it in the last two minutes (ONLINE_MS below).
// DECISION: until a device reports which engines it runs, every daemon device counts as running the three CLI drivers (claude_code, codex, grok).
// DECISION: engine.local_runs is on for everyone (placeTurn's default); there is no setting to turn it off yet.
const KINDS = new Set<string>(["chat", "channel", "thread", "ask", "run", "helper", "console"]);
const CLI_ENGINES = ["claude_code", "codex", "grok"] as const;
/** A device counts as online when the server heard from it this recently. */
const ONLINE_MS = 120_000;

interface ThreadOut { thread: { kind: string; members?: Array<{ kind: string; id: string }>; scopeType?: string } }
interface AgentOut { agent: { hasComputer?: boolean } }
interface DevicesOut { devices: Array<{ id: string; class: string; lastSeenAt?: number; revokedAt?: number }> }

/** The devices of the person the call acts for, as the placement rules see them: desktop apps and daemons run engines, phones, browsers and extensions do not. */
function devicesFrom(out: DevicesOut, now: number): PlaceDevice[] {
  return out.devices.filter((d) => d.revokedAt === undefined).map((d) => {
    const daemon = d.class === "desktop" || d.class === "daemon";
    return {
      id: d.id, role: daemon ? "daemon" as const : "client" as const, online: d.lastSeenAt !== undefined && now - d.lastSeenAt <= ONLINE_MS,
      engines: daemon ? CLI_ENGINES : [], ...(d.lastSeenAt !== undefined ? { lastSeen: d.lastSeenAt } : {}),
    };
  });
}

/** The engine driver this agent runs in this thread: the one saved for it, else Claude Code. */
function engineOf(ctx: EngineCtx, threadId: string, agentId: string): string {
  ensure(ctx.db);
  const r = (ctx.db.all("SELECT engine FROM engine_agent_state WHERE thread_id = ? AND agent_id = ?", threadId, agentId) as Row[])[0];
  const e = r?.["engine"];
  return typeof e === "string" && e !== "" ? e : "claude_code";
}

function askerOf(ctx: EngineCtx): string {
  const p = ctx.principal;
  if (p.kind === "person") return p.id;
  const f = (ctx as { actingFor?: string }).actingFor;
  if (f) return f;
  return raise(ctx, "permission.no_grant", "Only a person's turn has a place.");
}

export async function placementDecide(ctx: CallCtx, input: { threadId: string; agentId: string; kind: "message" | "interrupt" | "wake" | "handoff" }) {
  const asker = askerOf(ctx);
  const [t, a, d] = await Promise.all([
    ctx.call("threads.get", { threadId: input.threadId }) as Promise<ThreadOut>,
    ctx.call("agents.get", { agentId: input.agentId }) as Promise<AgentOut>,
    ctx.call("devices.mine", {}) as Promise<DevicesOut>,
  ]);
  const kind = (KINDS.has(t.thread.kind) ? t.thread.kind : "chat") as ThreadKind;
  const persons = new Set((t.thread.members ?? []).filter((m) => m.kind === "person").map((m) => m.id)).size;
  const place: PlaceInput = {
    thread: { kind, persons, onSharedRecord: kind === "ask" && t.thread.scopeType === "record" && persons > 1 },
    item: { kind: input.kind === "message" ? "message" : input.kind },
    agent: { hasComputer: a.agent.hasComputer === true },
    engine: engineOf(ctx, input.threadId, input.agentId),
    asker: { devices: devicesFrom(d, ctx.now()), runtimeOptIn: flagOn(ctx, asker, "runtime_opt_in") },
  };
  const p = placeTurn(place);
  return { placement: p.placement, reason: p.reason, ...(p.wakeLine ? { wakeLine: p.wakeLine } : {}) };
}

export function poolStatus(ctx: EngineCtx, _input: Record<string, never>) {
  const opener = openerOf();
  if (!opener) return { sessions: [], totalWarm: 0 };
  const s = opener.pool.status();
  return { sessions: s.sessions.map((d) => ({ driver: d.driver, warm: d.warm, max: d.max, hits: d.hits, misses: d.misses })), totalWarm: s.totalWarm };
}

/** The hint never waits for a key lookup or a process: it answers {warm:false} when there is nothing to warm, else {warm:true} and warms in the background. */
export async function warm(ctx: CallCtx, input: { threadId: string; agentId?: string }) {
  const opener = openerOf();
  if (!opener) return { warm: false };
  const asker = askerOf(ctx);
  void (async () => {
    try {
      const t = (await ctx.call("threads.get", { threadId: input.threadId })) as { thread: { agents: Array<{ agentId: string }> } };
      const agentId = input.agentId ?? t.thread.agents[0]?.agentId;
      if (!agentId) return;
      const acct = (await ctx.call("engine.account.resolve", { threadId: input.threadId, agentId, askerId: asker })) as { accountRef: string | null; payer: string | null; reason: string; itemId?: string };
      if (!acct.accountRef) return;
      const list = (await ctx.call("engine.accounts.list", { threadId: input.threadId, agentId })) as { accounts?: Array<{ ref: string; driver: string; kind: "api_key" | "subscription" }> };
      const row = list.accounts?.find((x) => x.ref === acct.accountRef);
      if (!row) return;
      const account = { ref: row.ref, driver: row.driver, provider: row.driver, kind: row.kind, payer: acct.payer ?? asker, reason: acct.reason, ...(acct.itemId ? { itemId: acct.itemId } : {}) } as unknown as ResolvedAccount;
      const spec: SessionSpec = { threadId: input.threadId, agent: { id: agentId, mode: "lead" }, asker, turnId: mintEngineId("t", ctx.now()), traceId: ctx.trace.traceId, account };
      opener.warm(spec);
    } catch { /* a hint that cannot be resolved is no hint */ }
  })();
  return { warm: true };
}
