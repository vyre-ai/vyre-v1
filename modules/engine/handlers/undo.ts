// Undo for what an agent turn changed (CHAT-DESIGN ruling 3: "changes go through normal capabilities, show live, and have Undo"). What a turn did is read from the event log: the events the agent wrote
// for the asker between the turn's start and end. Records and files already keep their history, so Undo puts each one back: a record's fields go back to what they were, a file to the version before the
// turn's first, a created record or file goes to Trash, a deleted one comes back. An act that left the Space (a send, a deploy, a published form) cannot be taken back: it is listed as such and left.
// Everything runs as the person who asks, through the same capabilities, so Undo can never reach further than they can.
import { boundEngine, ensure, raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

type Ev = { type: string; at: number; payload: Record<string, unknown> };
export interface Change { label: string; undoable: boolean }
type Step = { change: Change; run: (ctx: EngineCtx) => Promise<void> };

/** Events that mean something left the Space. */
export const OUTWARD: Readonly<Record<string, string>> = {
  "message.sent": "A message was sent", "signature.sent": "A document was sent for signature", "campaign.launched": "A campaign was launched",
  "form.published": "A form was published", "site.deployed": "A site was deployed", "site.promoted": "A site was promoted to production",
};

const TABLE = "CREATE TABLE IF NOT EXISTS engine_turn_undo (turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, by_principal TEXT NOT NULL, at INTEGER NOT NULL, count INTEGER NOT NULL)";
const ready = new WeakSet<object>();
function ensureTable(db: EngineCtx["db"]): void { if (!ready.has(db)) { db.run(TABLE); ready.add(db); } }
export const wasUndone = (ctx: Pick<EngineCtx, "db">, turnId: string): boolean => { ensureTable(ctx.db); return ctx.db.all("SELECT 1 FROM engine_turn_undo WHERE turn_id = ?", turnId).length > 0; };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nameOf = (type: string): string => type.replace(/_/g, " ");

/** The steps that put a turn's changes back, in the order to run them, and the changes that cannot be undone. */
export function stepsOf(events: readonly Ev[]): Step[] {
  const steps: Step[] = [];
  const recordPrev = new Map<string, { type: string; prev: Record<string, unknown>; fields: Set<string> }>();
  const created = new Map<string, string>();
  const firstVersion = new Map<string, number>();
  const filesCreated = new Set<string>();
  const outward: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const p = e.payload;
    if (e.type === "record.created") created.set(str(p["recordId"]), str(p["type"]));
    else if (e.type === "record.updated") {
      const id = str(p["recordId"]);
      if (created.has(id)) continue;   // created in this turn: going to Trash undoes the edits too
      const cur = recordPrev.get(id) ?? { type: str(p["type"]), prev: {}, fields: new Set<string>() };
      const prev = (p["prev"] ?? {}) as Record<string, unknown>;
      for (const k of Object.keys((p["fields"] ?? {}) as Record<string, unknown>)) if (!cur.fields.has(k)) { cur.fields.add(k); cur.prev[k] = k in prev ? prev[k] : null; }
      recordPrev.set(id, cur);
    } else if (e.type === "record.deleted") {
      const id = str(p["recordId"]);
      if (created.delete(id)) continue;
      const type = str(p["type"]);
      steps.push({ change: { label: `Moved a ${nameOf(type)} to Trash`, undoable: true }, run: async (c) => { await c.call("records.restore", { type, recordId: id }); } });
    } else if (e.type === "file.created") filesCreated.add(str(p["fileId"]));
    else if (e.type === "file.version_added") {
      const id = str(p["fileId"]);
      if (filesCreated.has(id) || firstVersion.has(id)) continue;
      firstVersion.set(id, Number(p["n"]));
    } else if (OUTWARD[e.type] && !seen.has(e.type)) { seen.add(e.type); outward.push(OUTWARD[e.type]!); }
  }
  for (const [id, type] of created) steps.push({ change: { label: `Created a ${nameOf(type)}`, undoable: true }, run: async (c) => { await c.call("records.delete", { type, recordId: id }); } });
  for (const [id, r] of recordPrev) {
    const fields = [...r.fields];
    steps.push({ change: { label: `Changed ${fields.slice(0, 3).join(", ")}${fields.length > 3 ? " and more" : ""} on a ${nameOf(r.type)}`, undoable: true }, run: async (c) => { await c.call("records.update", { type: r.type, recordId: id, patch: r.prev }); } });
  }
  for (const id of filesCreated) steps.push({ change: { label: "Created a file", undoable: true }, run: async (c) => { await c.call("files.delete", { fileId: id }); } });
  for (const [id, n] of firstVersion) {
    steps.push({
      change: { label: "Edited a file", undoable: n > 1 },
      run: async (c) => {
        const list = (await c.call("files.versions", { fileId: id })) as { versions?: Array<{ versionId?: string; id?: string; n: number }> };
        const before = list.versions?.find((v) => v.n === n - 1);
        const versionId = before?.versionId ?? before?.id;
        if (!versionId) throw new Error("the earlier version is gone");
        await c.call("files.restore_version", { fileId: id, versionId });
      },
    });
  }
  for (const what of outward) steps.push({ change: { label: `${what}. This can't be undone`, undoable: false }, run: async () => undefined });
  return steps;
}

/** The events the agent wrote for the asker during one turn. */
export async function turnEvents(ctx: EngineCtx, input: { threadId: string; turnId: string }): Promise<{ events: Ev[]; agentId: string } | null> {
  const engine = boundEngine(ctx);
  const turn = engine.turns(input.threadId).find((t) => t.id === input.turnId);
  if (!turn || turn.endedAt === null) return null;
  const out = (await ctx.call("events.list", { actor: turn.agentId, from: turn.startedAt - 1, to: turn.endedAt + 2_000, limit: 500 })) as { events?: Array<{ type: string; at: number; onBehalf?: string; payload: Record<string, unknown> }> };
  const events = (out.events ?? []).filter((e) => e.onBehalf === undefined || e.onBehalf === turn.asker).sort((a, b) => a.at - b.at);
  return { events, agentId: turn.agentId };
}

export async function turnChanges(ctx: EngineCtx, input: { threadId: string; turnId: string }): Promise<{ changes: Change[]; undone: boolean }> {
  ensure(ctx.db);
  await ctx.call("threads.get", { threadId: input.threadId });
  const found = await turnEvents(ctx, input);
  if (!found) raise(ctx, "validation.not_found", "That turn is not finished or is not in this chat.", { turnId: input.turnId });
  return { changes: stepsOf(found.events).map((s) => s.change), undone: wasUndone(ctx, input.turnId) };
}

export async function turnUndo(ctx: EngineCtx, input: { threadId: string; turnId: string }): Promise<{ undone: number; left: string[] }> {
  ensure(ctx.db);
  ensureTable(ctx.db);
  await ctx.call("threads.get", { threadId: input.threadId });
  if (wasUndone(ctx, input.turnId)) raise(ctx, "validation.precondition_failed", "That turn was already undone.", { turnId: input.turnId });
  const found = await turnEvents(ctx, input);
  if (!found) raise(ctx, "validation.not_found", "That turn is not finished or is not in this chat.", { turnId: input.turnId });
  const steps = stepsOf(found.events);
  let undone = 0;
  const left: string[] = [];
  for (const s of steps) {
    if (!s.change.undoable) { left.push(s.change.label); continue; }
    try { await s.run(ctx); undone++; } catch { left.push(`${s.change.label} (could not be undone: it changed again, or you may not edit it)`); }
  }
  ctx.db.run("INSERT OR REPLACE INTO engine_turn_undo (turn_id, thread_id, by_principal, at, count) VALUES (?, ?, ?, ?, ?)", input.turnId, input.threadId, ctx.principal.id, ctx.now(), undone);
  ctx.emit("turn.undone", input.threadId, { threadId: input.threadId, turnId: input.turnId, undone, by: ctx.principal.id });
  return { undone, left };
}

/** After a turn completes: if the agent changed something for the person, say so in the chat as one block with one Undo. A turn that changed nothing posts nothing. */
export async function announceChanges(
  h: { call(cap: string, input: unknown, as?: string): Promise<unknown>; postAs?: (agentId: string, post: { actingFor?: string; threadId: string; body: string; blocks: Array<{ type: string; v: number; data: unknown }>; mentions: unknown[]; clientId: string }) => Promise<unknown> },
  engine: Pick<ReturnType<typeof boundEngine>, "turns">, e: { threadId: string; turnId: string; agentId: string }, newId: () => string,
): Promise<number> {
  const turn = engine.turns(e.threadId).find((t) => t.id === e.turnId);
  if (!turn || turn.endedAt === null || !h.postAs || turn.routine || !turn.asker.startsWith("usr_")) return Promise.resolve(0);
  return (async () => {
    const out = (await h.call("events.list", { actor: e.agentId, from: turn.startedAt - 1, to: turn.endedAt! + 2_000, limit: 500 }, turn.asker)) as { events?: Array<{ type: string; at: number; onBehalf?: string; payload: Record<string, unknown> }> };
    const events = (out.events ?? []).filter((x) => x.onBehalf === undefined || x.onBehalf === turn.asker).sort((a, b) => a.at - b.at);
    const changes = stepsOf(events).map((s) => s.change);
    if (changes.length === 0) return 0;
    const n = changes.filter((c) => c.undoable).length;
    const summary = `${n > 0 ? `${n} change${n === 1 ? "" : "s"} made` : "Nothing that can be undone"}${changes.length > n ? `, ${changes.length - n} that can't be undone` : ""}`;
    // addressed to the person, so the lead does not answer a line about its own work
    await h.postAs!(e.agentId, { actingFor: turn.asker, threadId: e.threadId, body: "", blocks: [{ type: "turn_changes", v: 1, data: { threadId: e.threadId, turnId: e.turnId, agentId: e.agentId, summary, changes } }], mentions: [{ kind: "person", id: turn.asker }], clientId: newId() });
    return changes.length;
  })();
}
