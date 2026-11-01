// Vault requests (spec 2.17, ARCH 7.8, 6.11): an agent, skill or automation that needs a key it does not have asks for it by name. The request goes to the managers of the folder it names
// (or the Space's owners and admins) as one Needs you card each; the requester sees its status, and a Run waiting for the key resumes when it is supplied.
// DECISION: a request carries names, never values. A manager supplies the key in the fulfil call; the value goes straight to vault.item.put (or the item they name is shared) and is not stored here,
// not echoed back, not in an event, a card, a log line or the thread. The requester gets Use on the item, which hands out a handle and never the value.
// DECISION: the requester never decides their own request. Anyone who is neither the requester nor a manager gets "not found", so request ids leak nothing.
import { TABLE, asRow, idsOf, nid, page, raise, requestById, requestOut, strOf } from "../projections.ts";
import type { Ref, RequestRow, State, VaultReqCtx } from "../projections.ts";

const DEFAULT_FIELDS = ["value"];
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Who a call is for as a decider: the signed-in person, or the person an agent acts for. */
function personOf(ctx: VaultReqCtx): string | null {
  if (ctx.principal.kind === "person") return ctx.principal.id;
  return ctx.actingFor ?? null;
}
const requesterOf = (ctx: VaultReqCtx): Ref => ({ kind: ctx.principal.kind as Ref["kind"], id: ctx.principal.id });

/** The people who may decide a request: those with Manage on the folder, else on the Space (its owners and admins). The requester is never one of them. Asked of the access module's own decider list, so an agent that cannot see the folder still reaches a real person. */
export async function managersFor(ctx: VaultReqCtx, folderId: string | undefined, requester: string): Promise<string[]> {
  const ask = async (resource: { type: string; id: string }, why: string): Promise<string[]> => {
    try {
      const got = asRow(await ctx.call("access.deciders", { resource }));
      return (Array.isArray(got?.["people"]) ? (got["people"] as unknown[]) : []).map(String);
    } catch (e) {
      ctx.log.warn(`vault request: ${why} could not be read`, { error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  };
  const out = new Set<string>(folderId ? await ask({ type: "vault_folder", id: folderId }, "the folder's managers") : []);
  out.delete(requester);
  // ruling 74: when no folder claims the key, or only the requester manages it, the Space's owners decide
  if (out.size === 0) for (const p of await ask({ type: "space", id: ctx.space }, "the Space managers")) out.add(p);
  out.delete(requester);
  return [...out].sort();
}

/** "Dana_Lawmatics" reads "Dana Lawmatics key needed"; a name that already ends in key is not doubled. */
export function neededTitle(name: string): string {
  const words = name.replace(/_+/g, " ").trim();
  return /\bkey$/i.test(words) ? `${words} needed` : `${words} key needed`;
}

/** The chat the agent asked in and the agent's id, read back from the request's own card (no column holds them). */
async function chatOf(ctx: VaultReqCtx, row: RequestRow): Promise<{ threadId: string; agentId?: string } | null> {
  const taskId = idsOf(row.task_ids_json)[0];
  if (!taskId) return null;
  try {
    const t = asRow(asRow(await ctx.call("tasks.get", { taskId }))?.["task"]);
    const blocks = Array.isArray(t?.["blocks"]) ? (t!["blocks"] as unknown[]) : [];
    const d = asRow(asRow(blocks[0])?.["data"]);
    const threadId = strOf(d?.["threadId"]);
    return threadId ? { threadId, ...(strOf(d?.["agentId"]) ? { agentId: strOf(d?.["agentId"])! } : {}) } : null;
  } catch { return null; }
}

export async function requestCreate(ctx: VaultReqCtx, input: { name: string; fields?: string[]; reason: string; forRun?: string; folderId?: string; idempotencyKey: string }) {
  const trace = ctx.trace.traceId;
  const requester = requesterOf(ctx);
  const name = input.name.trim();
  if (!NAME.test(name)) raise(trace, "validation.bad_input", "Name the key like a handle: letters, digits and underscores, starting with a letter.");
  if (!input.reason.trim()) raise(trace, "validation.bad_input", "Say why the key is needed, so a manager can decide.");
  const fields = [...new Set((input.fields && input.fields.length > 0 ? input.fields : DEFAULT_FIELDS).map((f) => f.trim()))];
  for (const f of fields) if (!FIELD.test(f)) raise(trace, "validation.bad_input", `${f} is not a field name.`);

  const mine = ctx.db.all(`SELECT * FROM ${TABLE} WHERE requester_id = ?`, requester.id) as RequestRow[];
  const again = mine.find((r) => r.idem_key === input.idempotencyKey);
  if (again) return { request: requestOut(again) };
  if (mine.some((r) => r.state === "waiting" && r.name === name && r.folder_id === (input.folderId ?? null))) {
    raise(trace, "validation.duplicate", "You already asked for this key. The managers have it.");
  }

  const managers = await managersFor(ctx, input.folderId, requester.id);
  if (managers.length === 0) raise(trace, "validation.precondition_failed", "Nobody can decide this request.");
  const id = nid("vrq");
  const block = { type: "vault_request", v: 1, data: { requestId: id, name, fields, reason: input.reason.trim(), requester, ...(input.forRun ? { forRun: input.forRun } : {}), ...(input.folderId ? { folderId: input.folderId } : {}), ...(ctx.thread ? { threadId: ctx.thread } : {}), ...(ctx.thread && requester.kind === "agent" ? { agentId: requester.id } : {}), state: "waiting" } };
  const taskIds: string[] = [];
  for (const manager of managers) {
    const made = asRow(await ctx.call("tasks.create", {
      kind: "unblock", title: neededTitle(name), summary: input.reason.trim(), why: "Add the key to the Vault and it carries on.",
      ...(ctx.thread ? { notes: { thread: ctx.thread } } : {}),
      assigned: { kind: "person", id: manager }, source: { kind: "manual", id }, blocks: [block],
            // no "resolved" here: a key request closes only through vault.requests.fulfil (a key saved) or decline, never by pressing a bare Done
      actions: [{ key: "cannot", label: "Decline", note: "optional" }], idempotencyKey: `${id}:${manager}`,
    }));
    const taskId = strOf(asRow(made?.["task"])?.["id"]);
    if (!taskId) raise(trace, "internal.unexpected", "The task for the request was not created.");
    taskIds.push(taskId);
  }
  ctx.db.run(
    `INSERT INTO ${TABLE} (id, name, fields_json, reason, requester_kind, requester_id, for_run, folder_id, state, idem_key, managers_json, task_ids_json, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, JSON.stringify(fields), input.reason.trim(), requester.kind, requester.id, input.forRun ?? null, input.folderId ?? null, "waiting", input.idempotencyKey, JSON.stringify(managers), JSON.stringify(taskIds), ctx.now(),
  );
  const row = requestById(ctx, id)!;
  ctx.emit("vault.requested", id, { requestId: id, name, fields, requester, ...(input.forRun ? { forRun: input.forRun } : {}), taskId: taskIds[0]! });
  // the person asked in a chat: the ask lands there as a card, where they are (Needs you keeps its linked row)
  if (ctx.thread) {
    try { await ctx.call("chat.post", { threadId: ctx.thread, body: "", blocks: [block], idempotencyKey: `${id}:card` }); }
    catch (e) { ctx.log.warn("vault request: the chat card was not posted", { requestId: id, error: e instanceof Error ? e.message : String(e) }); }
  }
  return { request: requestOut(row) };
}

/** A request the caller made, or may decide. Anyone else gets "not found". */
function visible(ctx: VaultReqCtx, requestId: string): { row: RequestRow; asRequester: boolean; asManager: boolean } {
  const row = requestById(ctx, requestId);
  const me = personOf(ctx);
  const asRequester = !!row && (row.requester_id === ctx.principal.id || (!!ctx.actingFor && row.requester_id === ctx.actingFor));
  const asManager = !!row && !!me && row.requester_id !== me && idsOf(row.managers_json).includes(me);
  if (!row || (!asRequester && !asManager)) return raise(ctx.trace.traceId, "validation.not_found", "No such request.");
  return { row, asRequester, asManager };
}

export async function requestsList(ctx: VaultReqCtx, input: { mine?: boolean; state?: State; cursor?: string; limit?: number }) {
  const me = personOf(ctx);
  const ownIds = new Set([ctx.principal.id, ...(ctx.actingFor ? [ctx.actingFor] : [])]);
  const all = (ctx.db.all(`SELECT * FROM ${TABLE}`) as RequestRow[])
    .filter((r) => {
      const mine = ownIds.has(r.requester_id);
      const toDecide = !!me && r.requester_id !== me && idsOf(r.managers_json).includes(me);
      return input.mine === true ? mine : input.mine === false ? toDecide : mine || toDecide;
    })
    .filter((r) => !input.state || r.state === input.state)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))
    .map(requestOut);
  const p = page(all, input.cursor, input.limit);
  return { requests: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

export async function requestsGet(ctx: VaultReqCtx, input: { requestId: string }) {
  return { request: requestOut(visible(ctx, input.requestId).row) };
}

/** A card that cannot close is logged; the decision stands. */
async function closeCards(ctx: VaultReqCtx, row: RequestRow, to: "done" | "canceled", note: string): Promise<void> {
  for (const taskId of idsOf(row.task_ids_json)) {
    try {
      await ctx.call("tasks.transition", { taskId, to, note });
    } catch (e) {
      ctx.log.warn("vault request card did not close", { requestId: row.id, taskId, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** The agent that asked picks the work up again in the same chat, and says so: a short message from the person who answered, addressed to it. */
async function carryOn(ctx: VaultReqCtx, row: RequestRow, chat: { threadId: string; agentId?: string } | null, text: string): Promise<void> {
  if (!chat || !chat.agentId) return;
  try {
    await ctx.call("chat.post", { threadId: chat.threadId, body: text, mentions: [{ kind: "agent", id: chat.agentId }], idempotencyKey: `${row.id}:carry` });
  } catch (e) {
    ctx.log.warn("vault request: the agent was not told to carry on", { requestId: row.id, error: e instanceof Error ? e.message : String(e) });
  }
}

/** A manager decides a request that is still waiting. */
function decidable(ctx: VaultReqCtx, requestId: string): { row: RequestRow; me: string } {
  const { row, asManager } = visible(ctx, requestId);
  const me = personOf(ctx);
  if (!asManager || !me) return raise(ctx.trace.traceId, "permission.no_grant", "Only a manager of this Vault can decide this request.");
  if (row.state !== "waiting") return raise(ctx.trace.traceId, "validation.precondition_failed", `This request was already ${row.state}.`);
  return { row, me };
}

export async function requestsFulfil(ctx: VaultReqCtx, input: { requestId: string; itemId?: string; fields?: { key: string; value: string }[]; folderId?: string }) {
  const trace = ctx.trace.traceId;
  const { row, me } = decidable(ctx, input.requestId);
  const hasFields = !!input.fields && input.fields.length > 0;
  if (!input.itemId === !hasFields) raise(trace, "validation.bad_input", "Attach an item, or give the fields for a new one, not both and not neither.");
  const wanted = idsOf(row.fields_json);
  let itemId = input.itemId;

  if (itemId) {
    const got = asRow(await ctx.call("vault.item.get", { itemId }));
    const keys = Array.isArray(asRow(got?.["item"])?.["fieldKeys"]) ? ((asRow(got?.["item"])?.["fieldKeys"]) as unknown[]).map(String) : [];
    const missing = wanted.filter((f) => !keys.includes(f));
    if (missing.length > 0) raise(trace, "validation.precondition_failed", `That item has no ${missing.join(", ")} field.`);
  } else {
    const given = new Map((input.fields ?? []).map((f) => [f.key, f.value] as const));
    const missing = wanted.filter((f) => !(given.get(f)?.length));
    if (missing.length > 0) raise(trace, "validation.precondition_failed", `The key needs a value for ${missing.join(", ")}.`);
    const folderId = input.folderId ?? row.folder_id ?? undefined;
    if (!folderId) raise(trace, "validation.precondition_failed", "Choose the folder the new item goes in.");
    const made = asRow(await ctx.call("vault.item.put", {
      folderId, name: row.name, kind: "api_key", fields: (input.fields ?? []).map((f) => ({ key: f.key, value: f.value, secret: true })), idempotencyKey: `${row.id}:put`,
    }));
    itemId = strOf(asRow(made?.["item"])?.["id"]);
    if (!itemId) raise(trace, "internal.unexpected", "The item was not saved.");
  }

  // the requester gets Use: a handle to fill, never the value
  try {
    await ctx.call("vault.share", { resource: { type: "vault_item", id: itemId }, subject: { kind: row.requester_kind, id: row.requester_id }, level: "use", idempotencyKey: `${row.id}:use` });
  } catch (e) {
    // a Mine item is private to its owner: an agent acting for that person already works as them, so there is nothing to share. Any other refusal stands.
    if (!/private/i.test(e instanceof Error ? e.message : "") ) throw e;
  }

  ctx.db.run(`UPDATE ${TABLE} SET state = ?, item_id = ?, decided_by = ?, decided_at = ? WHERE id = ?`, "fulfilled", itemId, me, ctx.now(), row.id);
  ctx.emit("vault.request_fulfilled", row.id, { requestId: row.id, itemId, ...(row.for_run ? { forRun: row.for_run } : {}) });
  const chat = await chatOf(ctx, row);
  await closeCards(ctx, row, "done", "Provided");
  await carryOn(ctx, row, chat, `I added the ${row.name.replace(/_+/g, " ")} key. Carry on.`);
  if (row.for_run) {
    try {
      await ctx.call("runs.resume", { runId: row.for_run, reason: "key" });
    } catch (e) {
      ctx.log.warn("vault request: the waiting run did not resume", { requestId: row.id, runId: row.for_run, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { request: requestOut(requestById(ctx, row.id)!) };
}

export async function requestsDecline(ctx: VaultReqCtx, input: { requestId: string; note?: string }) {
  const { row, me } = decidable(ctx, input.requestId);
  const note = input.note?.trim() || null;
  ctx.db.run(`UPDATE ${TABLE} SET state = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ?`, "declined", note, me, ctx.now(), row.id);
  ctx.emit("vault.request_declined", row.id, { requestId: row.id, ...(row.for_run ? { forRun: row.for_run } : {}), ...(note ? { note } : {}) });
  const chat = await chatOf(ctx, row);
  await closeCards(ctx, row, "canceled", note ? `Declined: ${note}` : "Declined");
  await carryOn(ctx, row, chat, note ? `I did not add the ${row.name.replace(/_+/g, " ")} key: ${note}` : `I did not add the ${row.name.replace(/_+/g, " ")} key.`);
  return { ok: true };
}

export async function requestsCancel(ctx: VaultReqCtx, input: { requestId: string }) {
  const { row, asRequester } = visible(ctx, input.requestId);
  if (!asRequester) raise(ctx.trace.traceId, "permission.no_grant", "Only the person who asked can withdraw a request.");
  if (row.state !== "waiting") raise(ctx.trace.traceId, "validation.precondition_failed", `This request was already ${row.state}.`);
  ctx.db.run(`UPDATE ${TABLE} SET state = ?, decided_by = ?, decided_at = ? WHERE id = ?`, "canceled", ctx.principal.id, ctx.now(), row.id);
  ctx.emit("vault.request_canceled", row.id, { requestId: row.id });
  await closeCards(ctx, row, "canceled", "Withdrawn");
  return { ok: true };
}
