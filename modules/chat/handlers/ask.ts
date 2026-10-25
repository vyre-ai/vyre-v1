// @reads /modules/chat/migrations/0002_private.sql
// Ask panes (spec 4.8, 2.5; ARCH 4.13): a private thread of kind `ask` about one object. chat.start makes it (thread.ts); this file is the rest of its life.
//   chat.ask_suggest    who to ask: the agent that booked the event, else the contact's agent, else the agent the person last asked. Reads the object through the capability API, so what the
//                       person may not see is refused there; an object the person cannot see at all gets the Ask for access link instead of an answer.
//   chat.asks_of        the pane history of one object: the caller's own Ask panes on it, newest first, listed or not. An Ask pane is private, so nobody else's appear, an admin's included.
//   chat.open_as_chat   the Recent rule: an Ask pane stays out of Recent (listed = 0) until its owner opens it as a chat.
// Scope columns (scopeType, scopeId) are written once by chat.start and never change: the pane belongs to the object it was opened on.
import { fail } from "../../../host/src/routes/errors.ts";
import type { CapName, NextStep, ResourceRefValue, ResourceType } from "../../../packages/contracts/src/types.ts";
import { askerOf, ensure, raise, threadBy, threadOf, threadOut } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";

type Row = Record<string, unknown>;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** The resource type an Ask scope names, where the object is a resource of its own. Events and pages are read through their own capability (see below), which carries the same refusal. */
const RESOURCE_OF: Readonly<Record<string, ResourceType>> = {
  record: "record", file: "file", folder: "folder", site: "site", automation: "automation", form: "form", campaign: "campaign", project: "project", run: "run", agent: "agent", task: "task",
};

type Call = NonNullable<ChatCtx["call"]>;
const callOf = (ctx: ChatCtx): Call => {
  if (!ctx.call) raise(ctx, "internal.unexpected", "This server cannot reach the other capabilities an Ask pane needs.");
  return ctx.call as Call;
};

function validScope(ctx: ChatCtx, scopeType: string, scopeId: string): void {
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(scopeType) || scopeId.trim() === "" || scopeId.length > 200) raise(ctx, "validation.bad_input", "Name the object with its type and id.", { scopeType, scopeId });
}

/** The Ask for access step for an object: the same shape the tool refusals carry (agent/src/tools/call.ts), so the locked state shows one button everywhere. */
export function askAccessNext(resource: ResourceRefValue): NextStep[] {
  return [{ kind: "ask_access", label: "Ask for access", action: { cap: "access.request" as CapName, input: { resource, level: "view" } } }];
}

/** Can the person see the object an Ask pane is about? Fails with permission.no_grant and the Ask for access link when not. Objects with no resource of their own are read through their capability. */
export async function requireView(ctx: ChatCtx, scopeType: string, scopeId: string): Promise<void> {
  const type = RESOURCE_OF[scopeType];
  if (type === undefined) return;
  const resource: ResourceRefValue = { type, id: scopeId };
  // The host's own authorize first (the caller's access, no capability call needed: a member may not call access.check). A hand-built test context without it asks access.check.
  const host = ctx as ChatCtx & { authorize?: (action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => { effect?: string } };
  let effect: string | undefined;
  if (typeof host.authorize === "function") effect = host.authorize({ perm: null, level: "view" }, { type, id: scopeId }).effect;
  else effect = ((await callOf(ctx)("access.check", { principal: { kind: "person", id: askerOf(ctx) }, action: { level: "view" }, resource })) as { decision?: { effect?: string } } | null | undefined)?.decision?.effect;
  if (effect !== "allow") {
    throw fail("permission.no_grant", ctx.trace.traceId, { message: "You cannot see this yet, so there is nothing to ask about.", details: { reason: "no_view", scopeType, scopeId }, next: askAccessNext(resource) });
  }
}

export type SuggestReason = "booked_by" | "contact_agent" | "last_used" | "none";
const AGENT_ID = /^agt_[a-z0-9]+$/;

async function recordField(ctx: ChatCtx, type: string, recordId: string, field: string): Promise<string | undefined> {
  const out = (await callOf(ctx)("records.get", { type, recordId })) as { record?: { fields?: Record<string, unknown> } } | null | undefined;
  const v = out?.record?.fields?.[field];
  return typeof v === "string" && AGENT_ID.test(v) ? v : undefined;
}

export async function askSuggest(ctx: ChatCtx, input: { scopeType: string; scopeId: string }): Promise<{ agentId: string | null; reason: SuggestReason }> {
  ensure(ctx.db);
  validScope(ctx, input.scopeType, input.scopeId);
  await requireView(ctx, input.scopeType, input.scopeId);
  const call = callOf(ctx);

  // 1 the agent that booked the event
  if (input.scopeType === "event") {
    const out = (await call("calendar.get_event", { eventId: input.scopeId })) as { event?: { bookedByAgentId?: unknown; recordIds?: unknown } } | null | undefined;
    const booked = out?.event?.bookedByAgentId;
    if (typeof booked === "string" && AGENT_ID.test(booked)) return { agentId: booked, reason: "booked_by" };
    // 2 the contact's agent, for a contact linked to the event
    const linked = Array.isArray(out?.event?.recordIds) ? (out!.event!.recordIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    for (const rec of linked) {
      try {
        const agent = await recordField(ctx, "contact", rec, "agent");
        if (agent) return { agentId: agent, reason: "contact_agent" };
      } catch { /* a linked record that is not a contact, or one the person cannot read, is not a contact agent */ }
    }
  }
  // 2 the contact's agent, for a contact record
  if (input.scopeType === "record" || input.scopeType === "contact") {
    try {
      const agent = await recordField(ctx, "contact", input.scopeId, "agent");
      if (agent) return { agentId: agent, reason: "contact_agent" };
    } catch { /* not a contact */ }
  }
  // 3 the agent this person last asked, a person setting
  const last = (await call("settings.get", { key: "chat.ask_agent" })) as { row?: { value?: unknown } } | null | undefined;
  const v = last?.row?.value;
  if (typeof v === "string" && AGENT_ID.test(v)) return { agentId: v, reason: "last_used" };
  return { agentId: null, reason: "none" };
}

// ---- the pane history -------------------------------------------------------------------------------------------------------------------------------

export async function asksOf(ctx: ChatCtx, input: { resourceType: string; resourceId: string; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  validScope(ctx, input.resourceType, input.resourceId);
  await requireView(ctx, input.resourceType, input.resourceId);
  const asker = askerOf(ctx);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const where = "kind = 'ask' AND scopeType = ? AND scopeId = ? AND starter = ? AND deleted_at IS NULL";
  const total = Number((ctx.db.all(`SELECT COUNT(*) AS n FROM chat_thread WHERE ${where}`, input.resourceType, input.resourceId, asker) as Row[])[0]?.["n"] ?? 0);
  let after: { at: number; id: string } | null = null;
  if (input.cursor !== undefined) {
    const m = /^(\d+):(thr_[a-z0-9]+)$/.exec(input.cursor);
    if (!m) raise(ctx, "validation.bad_input", "That page marker is not one this list gave out.", { cursor: input.cursor });
    after = { at: Number(m![1]), id: m![2]! };
  }
  const rows = (after
    ? ctx.db.all(`SELECT * FROM chat_thread WHERE ${where} AND (createdAt < ? OR (createdAt = ? AND id < ?)) ORDER BY createdAt DESC, id DESC LIMIT ?`, input.resourceType, input.resourceId, asker, after.at, after.at, after.id, limit + 1)
    : ctx.db.all(`SELECT * FROM chat_thread WHERE ${where} ORDER BY createdAt DESC, id DESC LIMIT ?`, input.resourceType, input.resourceId, asker, limit + 1)) as Row[];
  const page = rows.slice(0, limit).map(threadOf);
  const last = page[page.length - 1];
  return { threads: page.map((t) => threadOut(ctx.db, t)), total, ...(rows.length > limit && last ? { next: `${last.createdAt}:${last.id}` } : {}) };
}

// ---- the Recent rule --------------------------------------------------------------------------------------------------------------------------------

export async function openAsChat(ctx: ChatCtx, input: { threadId: string }) {
  ensure(ctx.db);
  const t = threadBy(ctx.db, input.threadId);
  // An Ask pane is the asker's own: for anyone else it does not exist.
  if (!t || t.kind !== "ask" || t.starter !== askerOf(ctx)) raise(ctx, "validation.not_found", "That Ask pane does not exist or is not yours.");
  if (t.listed) return { thread: threadOut(ctx.db, t) };
  ctx.db.run("UPDATE chat_thread SET listed = 1, version = version + 1, updated_at = ? WHERE id = ?", ctx.now(), t.id);
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["listed"] });
  return { thread: threadOut(ctx.db, threadBy(ctx.db, t.id)!) };
}
