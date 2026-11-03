// engine module entry (lane L2). The host loads the generated stubs while manifests/engine.ts says `status: 'stub'`; the last engine packet flips it to live
// (host/modules.json, ruling 25) after the contract tests pass against these handlers. Capabilities not listed in `handlers` stay on their stubs until then.
//
// Also here: the runtime that wires the turn engine to this module's SQL (queue, lease, messages, parked tool calls), so a second host that takes a thread over
// with recover() replays the same message bodies, and a tool call held at the Gate parks the turn on its task (turn.waiting) until resume().
import { createTurnEngine } from "../../agent/src/turn-engine/engine.ts";
import type { EngineOptions, TurnEngine } from "../../agent/src/turn-engine/engine.ts";
import { handlers as table } from "./handlers/index.ts";
import { bindEngine, mintEngineId, sqlLeases, sqlMessages, sqlQueue, sqlWaits } from "./projections.ts";
import type { Db } from "./projections.ts";
import type { Handler } from "../../host/src/invoke.ts";
import { bridgeConsumers } from "./handlers/bridge.ts";
import { gateResumeConsumers } from "./handlers/gate-resume.ts";
import { sweepWaits } from "./crew-waits.ts";
import { reconcileAll } from "./handlers/crew.ts";
import { captureConsumers, capturePeriodic } from "./handlers/capture.ts";
import { checkGroupAccount } from "./group-account.ts";
import { closeNoAccountTasks, engineHost, ensureRuntime, openAs, recoverStale, setEngineHost, wakeAfterUnblock } from "./runtime.ts";
import { onTaskEvent, sweepBaton } from "./handlers/task-baton.ts";
import { onRoutineRun } from "./handlers/routine-run.ts";
import type { RoutineRunEvent } from "./handlers/routine-run.ts";
import { onGoalEvent } from "./handlers/goal-wake.ts";
import { markLostJobs, ownerChanged, resumeAgent, stopAgent, stopPerson } from "./handlers/departures.ts";
import type { EngineCtx } from "./projections.ts";
import { installOnConnect } from "./engine-setup.ts";
import { heldNote, queueHeldNote } from "./held-notes.ts";
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";

// Every engine capability first makes sure the runtime exists on a daemon that wired the engine seam (the first call builds it; a daemon without the seam leaves it unbound).
export const handlers: Record<string, Handler> = Object.fromEntries(
  Object.entries(table as unknown as Record<string, Handler>).map(([name, fn]) => [name, (async (ctx, input) => { await ensureRuntime(ctx as never); return fn(ctx, input); }) as Handler]),
);

export { nodeCliLauncher, nodeCliReport } from "./node-cli.ts";

/** The host half arrives here at boot (ruling 31 and 32): the runtime opens real sessions through it. */
export const hostSeams = { setEngineHost };

/** The runtime is built at boot, not at the first message, and recovers threads a dead host left mid-turn. */
export const periodic = {
  "engine.runtime": { everyMs: 5_000, run: async (ctx: EngineCtx): Promise<void> => { const engine = await ensureRuntime(ctx); if (engine) await recoverStale(ctx, engine); } },
  /** A baton an agent stopped on goes to a person after nudgeMinutes (handlers/task-baton.ts). */
  "engine.task_baton_sweep": {
    everyMs: 60_000,
    run: async (ctx: EngineCtx): Promise<string[]> => {
      const host = engineHost();
      if (!host) return [];
      return sweepBaton(ctx, { call: host.call, now: () => ctx.now(), ...(host.log ? { log: host.log } : {}) }, await ensureRuntime(ctx));
    },
  },
  /** The checks a crew's lead is waiting on, looked at by the host every 15 s (crew-waits.ts). */
  "engine.crew_waits": {
    everyMs: 15_000,
    run: async (ctx: EngineCtx): Promise<string[]> => {
      const host = engineHost();
      if (!host) return [];
      const ended = await sweepWaits({ db: ctx.db, host, now: () => ctx.now() });
      await reconcileAll(ctx).catch(() => []);   // a branch merged or pushed any other way flips its card and its Crew row
      markLostJobs(ctx);   // a Job nothing is running for any more says so
      return ended;
    },
  },
  ...capturePeriodic,
};

/** A task reached Done: if it was the Unblock for a turn with no account, wake that agent in that thread. */
/**
 * A consumer that hands work to the engine builds the runtime first. The runtime is built by the first engine call and by a periodic job every few seconds, so a message that arrives
 * before either (the first message after a server restart) would find no engine, be skipped and never get a turn. Building here is the same ensureRuntime the first call makes: once, idempotent.
 */
const withRuntime = <C extends Record<string, { run: (ctx: EngineCtx, event: never) => Promise<unknown> }>>(consumers: C): C => Object.fromEntries(
  Object.entries(consumers).map(([name, c]) => [name, { ...c, run: async (ctx: EngineCtx, event: never): Promise<unknown> => { await ensureRuntime(ctx); return c.run(ctx, event); } }]),
) as C;

export const consumers = {
  ...withRuntime(bridgeConsumers),
  ...withRuntime(gateResumeConsumers),
  ...captureConsumers,
  /** An agent ended or stopped: what it had running stops with it, and a Job follows (running, paused, lost, stopped). */
  "engine.agent_lifecycle": {
    on: ["agent.deleted", "agent.paused", "agent.resumed"],
    run: async (ctx: EngineCtx, event: { name: string; payload: { agentId: string } }): Promise<string[]> => {
      const engine = await ensureRuntime(ctx);
      const id = event.payload.agentId;
      if (event.name === "agent.deleted") return stopAgent(ctx, engine, id, "stopped");
      if (event.name === "agent.paused") return stopAgent(ctx, engine, id, "paused");
      return resumeAgent(ctx, engine, id, async (threadId, asker) => { await openAs(ctx, threadId, asker); });
    },
  },
  /** A person left: nothing goes on running on their word or their account. */
  "engine.person_left": {
    on: ["member.removed"],
    run: async (ctx: EngineCtx, event: { payload: { personId: string } }): Promise<string[]> => stopPerson(ctx, await ensureRuntime(ctx), event.payload.personId),
  },
  /** The owner of a chat changed: its next turn runs for them. */
  "engine.thread_owner": {
    on: ["thread.updated"],
    run: async (ctx: EngineCtx, event: { payload: { threadId: string; starter?: string } }): Promise<void> => { if (event.payload.starter) ownerChanged(await ensureRuntime(ctx), event.payload.threadId, event.payload.starter); },
  },
  /** A person or an agent joined a group: say who an agent there could not answer (group-account.ts). */
  "engine.group_account": {
    on: ["channel.member_added", "channel.agent_added"],
    run: async (_ctx: EngineCtx, event: { payload: { threadId?: string; channelId?: string; personId?: string } }): Promise<string[]> => {
      const h = engineHost();
      if (!h) return [];
      const p = event.payload;
      const threadId = p.threadId ?? (p.channelId ? ((await h.call("channels.get", { channelId: p.channelId })) as { channel: { mainThreadId: string } }).channel.mainThreadId : undefined);
      return threadId ? checkGroupAccount(h, threadId, p.personId ? [p.personId] : undefined) : [];
    },
  },
  "engine.no_account_sweep": {
    on: ["provider.added"],
    run: async (ctx: EngineCtx): Promise<string[]> => closeNoAccountTasks(ctx.db),
  },
  /** A Claude, Codex or Grok sign-in was connected: Vyre installs that engine on this computer in the background when it is not here, so the first chat does not wait for it (engine-setup.ts). */
  "engine.install_on_connect": {
    on: ["provider.added"],
    run: async (_ctx: EngineCtx, event: { payload: { providerKey?: string } }): Promise<string[]> => installOnConnect(event.payload.providerKey, { ...(engineHost()?.log ? { log: engineHost()!.log! } : {}) }),
  },
  /** The baton of a work task landed on an agent: wake it in the task's thread (handlers/task-baton.ts). */
  "engine.task_baton": {
    on: ["task.created", "task.assigned", "task.transitioned", "task.delegated", "task.escalated", "task.taken", "task.released", "task.withdrawn", "task.ready", "task.children_settled", "task.updated"],
    run: async (ctx: EngineCtx, event: Parameters<typeof onTaskEvent>[3]): Promise<string[]> => {
      const engine = await ensureRuntime(ctx);
      const host = engineHost();
      if (!engine || !host) return [];
      return onTaskEvent(ctx, { call: host.call, now: () => ctx.now(), ...(host.log ? { log: host.log } : {}) }, engine, event);
    },
  },
  /** A routine's run started (its time came, or Run Now): its agent acts on the routine's instructions in the routine's chat, for its owner (handlers/routine-run.ts). */
  "engine.routine_run": {
    on: ["agent.routine_run_started"],
    run: async (ctx: EngineCtx, event: RoutineRunEvent): Promise<string[]> => {
      const engine = await ensureRuntime(ctx);
      const host = engineHost();
      if (!engine || !host) return [];
      return onRoutineRun(ctx, { call: host.call, ...(host.log ? { log: host.log } : {}) }, engine, async (threadId, person) => { await openAs(ctx, threadId, person); }, event);
    },
  },
  /** A goal's lead is due a turn in the goal chat, or a paused goal goes on (handlers/goal-wake.ts). */
  "engine.goal_wake": {
    on: ["goal.woken", "goal.resumed"],
    run: async (ctx: EngineCtx, event: Parameters<typeof onGoalEvent>[3]): Promise<string[]> => {
      const engine = await ensureRuntime(ctx);
      const host = engineHost();
      if (!engine || !host) return [];
      return onGoalEvent(ctx, { call: host.call, now: () => ctx.now(), ...(host.log ? { log: host.log } : {}) }, engine, event);
    },
  },
  /** A key an agent asked for in a chat was added or declined: the agent is told in that chat, as the person it asked for, and carries on. */
  "engine.key_request_answered": {
    on: ["vault.request_fulfilled", "vault.request_declined"],
    run: async (ctx: EngineCtx, event: { name: string; payload: { requestId: string; name?: string; handle?: string; note?: string; threadId?: string; agentId?: string; asker?: string } }): Promise<string[]> => {
      const p = event.payload;
      const host = engineHost();
      if (!host || !p.threadId || !p.agentId || !p.asker) return [];
      await ensureRuntime(ctx);
      const key = (p.name ?? "").replace(/_+/g, " ").replace(/\s+key$/i, "").trim();
      // the handle names this very item: another one may hold the name (a team key of the same name), and the handle is how the agent reaches it
      const text = event.name === "vault.request_fulfilled" ? `I added the ${key} key${p.handle ? ` as ${p.handle}` : ""}. Carry on.` : `I did not add the ${key} key${p.note ? `: ${p.note}` : "."}`;
      try { await host.call("chat.post", { threadId: p.threadId, body: text, mentions: [{ kind: "agent", id: p.agentId }], idempotencyKey: `${p.requestId}:carry` }, p.asker); }
      catch (e) { host.log?.("the agent was not told its key was answered", { requestId: p.requestId, error: e instanceof Error ? e.message : String(e) }); return []; }
      return [p.requestId];
    },
  },
  /** Access an agent asked for in a chat was approved or declined: the agent is told in that chat, as the person it asked for, and carries on. */
  "engine.access_answered": {
    on: ["access.granted", "access.declined"],
    run: async (ctx: EngineCtx, event: { name: string; payload: { requestId: string; requester: string; note?: string; threadId?: string; agentId?: string } }): Promise<string[]> => {
      const p = event.payload;
      const host = engineHost();
      if (!host || !p.threadId || !p.agentId) return [];
      await ensureRuntime(ctx);
      const text = event.name === "access.granted" ? "My access came through. Carry on." : `My access was declined${p.note ? `: ${p.note}` : "."}`;
      try { await host.call("chat.post", { threadId: p.threadId, body: text, mentions: [{ kind: "agent", id: p.agentId }], idempotencyKey: `${p.requestId}:carry` }, p.requester); }
      catch (e) { host.log?.("the agent was not told its access was answered", { requestId: p.requestId, error: e instanceof Error ? e.message : String(e) }); return []; }
      return [p.requestId];
    },
  },
  /**
   * A call an agent's CLI engine made over MCP was held at the Gate and a person answered it (lane l-runson: on the Space's server and on a person's own computer alike). The engine was told at once
   * that the call waits, and its turn ended. Now the agent's next turn starts in the chat the hold names, with a note from Vyre as its input (held-notes.ts): approved and what it gave back, or
   * declined and why. Nothing is posted in the person's name; the chat gets a quiet line ("Approved by Olivia") as the agent's turn status. A turn parked on the hold (an API engine's) resumes by
   * itself and is left alone.
   */
  "engine.hold_answered": {
    on: ["gate.approved", "gate.denied"],
    run: async (ctx: EngineCtx, event: { name: string; payload: { taskId?: string; holdId?: string; capName?: string; threadId?: string; agentId?: string; actingFor?: string; askedBy?: { kind?: string; id?: string }; by?: string; note?: string } }): Promise<string[]> => {
      const p = event.payload;
      const host = engineHost();
      const agentId = p.agentId ?? (p.askedBy?.kind === "agent" ? p.askedBy.id : undefined);
      const person = p.actingFor?.startsWith("usr_") ? p.actingFor : p.askedBy?.kind === "agent" && p.by?.startsWith("usr_") ? p.by : undefined;
      if (!host || !p.taskId || !p.holdId || !p.threadId?.startsWith("thr_") || !agentId || !person) return [];
      try { if (ctx.db.all("SELECT 1 AS x FROM engine_waits WHERE task_id = ?", p.taskId).length > 0) return []; } catch { /* no parked turns yet */ }
      const engine = await ensureRuntime(ctx);
      if (!engine) return [];
      const approved = event.name === "gate.approved";
      let by = "a person";
      try { const n = ((await host.call("access.principals.get", { principal: { kind: "person", id: p.by ?? person } })) as { principal?: { name?: unknown } }).principal?.name; if (typeof n === "string" && n.trim() !== "") by = n.trim(); } catch { /* a person all the same */ }
      let result: unknown;
      if (approved) { try { const r = (await host.call("gate.result.take", { holdId: p.holdId })) as { found?: boolean; result?: unknown }; if (r.found) result = r.result; } catch { /* what it gave back is a convenience */ } }
      queueHeldNote(p.threadId, agentId, heldNote({ approved, cap: p.capName ?? "call", by, ...(result !== undefined ? { result } : {}), ...(p.note ? { note: p.note } : {}) }));
      if (host.postAs) {
        await Promise.resolve(host.postAs(agentId, { actingFor: person, threadId: p.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintEngineId("b", ctx.now()).slice(2), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text: `${approved ? "Approved" : "Declined"} by ${by}` } }] }))
          .catch((e: unknown) => host.log?.("the answer to a held call was not shown in the chat", { taskId: p.taskId, error: e instanceof Error ? e.message : String(e) }));
      }
      try { await openAs(ctx, p.threadId, person); engine.wake(p.threadId, agentId); }
      catch (e) { host.log?.("the agent was not woken after its held call was answered", { taskId: p.taskId, error: e instanceof Error ? e.message : String(e) }); return []; }
      return [p.taskId];
    },
  },
  /**
   * Redaction for AI: an agent asked to read a file in a Redacted folder nobody had reviewed ("Redact before I can read"); the request card goes into the chat it asked in, as the agent, with
   * Open to review. A request with no chat is a Review task for the person (the files module makes it).
   */
  "engine.redact_requested": {
    on: ["file.redact_requested"],
    run: async (ctx: EngineCtx, event: { payload: { requestId: string; fileId: string; name: string; agentId?: string; actingFor?: string; threadId?: string } }): Promise<string[]> => {
      const p = event.payload, host = engineHost();
      if (!host?.postAs || !p.threadId?.startsWith("thr_") || !p.agentId || !p.actingFor?.startsWith("usr_")) return [];
      await Promise.resolve(host.postAs(p.agentId, {
        actingFor: p.actingFor, threadId: p.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintEngineId("b", ctx.now()).slice(2),
        blocks: [{ type: "redact_request", v: 1, data: { requestId: p.requestId, fileId: p.fileId, name: p.name, agentId: p.agentId, state: "waiting" } }],
      })).catch((e: unknown) => host.log?.("the request to read was not shown in the chat", { requestId: p.requestId, error: e instanceof Error ? e.message : String(e) }));
      return [p.requestId];
    },
  },
  /** Done on a file an agent asked for: the agent's next turn starts in that chat with a note from Vyre, the same wake path as an approved held call. */
  "engine.redact_ready": {
    on: ["file.redact_ready"],
    run: async (ctx: EngineCtx, event: { payload: { requestId: string; fileId: string; name: string; by: string; agentId?: string; actingFor?: string; threadId?: string } }): Promise<string[]> => {
      const p = event.payload, host = engineHost();
      if (!host || !p.threadId?.startsWith("thr_") || !p.agentId || !p.actingFor?.startsWith("usr_")) return [];
      const engine = await ensureRuntime(ctx);
      if (!engine) return [];
      let by = "a person";
      try { const n = ((await host.call("access.principals.get", { principal: { kind: "person", id: p.by } })) as { principal?: { name?: unknown } }).principal?.name; if (typeof n === "string" && n.trim() !== "") by = n.trim(); } catch { /* a name is a courtesy */ }
      queueHeldNote(p.threadId, p.agentId, `${by} reviewed ${p.name} (file ${p.fileId}). Read it again now: you get the redacted version, with [REDACTED] where a part is hidden. Do not guess what a redacted part says; if you need it, say so and ask ${by} to un-redact it.`);
      if (host.postAs) {
        await Promise.resolve(host.postAs(p.agentId, { actingFor: p.actingFor, threadId: p.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintEngineId("b", ctx.now()).slice(2), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text: `Reviewed by ${by}` } }] }))
          .catch((e: unknown) => host.log?.("the review was not shown in the chat", { requestId: p.requestId, error: e instanceof Error ? e.message : String(e) }));
      }
      try { await openAs(ctx, p.threadId, p.actingFor); engine.wake(p.threadId, p.agentId); }
      catch (e) { host.log?.("the agent was not woken after the file was reviewed", { requestId: p.requestId, error: e instanceof Error ? e.message : String(e) }); return []; }
      return [p.requestId];
    },
  },
  "engine.unblock": {
    on: ["task.completed"],
    run: async (ctx: EngineCtx, event: { payload: { taskId: string } }): Promise<string[]> => ((await wakeAfterUnblock(ctx, event.payload.taskId)) ? [event.payload.taskId] : []),
  },
};

export interface RuntimeOptions extends Omit<EngineOptions, "queue" | "leases" | "messages" | "waits" | "newId"> {
  db: Db;
}

/** The turn engine on this module's tables. Bind it (bindEngine) so the control handlers reach it. */
export function createEngineRuntime(o: RuntimeOptions): TurnEngine {
  const { db, ...rest } = o;
  const now = o.now ?? Date.now;
  return createTurnEngine({ ...rest, queue: sqlQueue(db), leases: sqlLeases(db), messages: sqlMessages(db, now), waits: sqlWaits(db), newId: (p) => mintEngineId(p, now()) });
}

export { bindEngine, sqlLeases, sqlMessages, sqlQueue, sqlWaits };

/** A Gate task was answered: queue the wake that continues the turn parked on it. Null when this host holds no turn parked on that task. */
export function resumeHeld(engine: TurnEngine, taskId: string, approved: boolean): number | null {
  return engine.resume(taskId, { approved });
}
