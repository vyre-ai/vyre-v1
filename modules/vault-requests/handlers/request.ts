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

/** The people who may decide a request: the managers of the folder, else the Space owner and its owners and admins. The requester is never one of them. */
export async function managersFor(ctx: VaultReqCtx, folderId: string | undefined, requester: string): Promise<string[]> {
  const out = new Set<string>();
  if (folderId) {
    try {
      const got = asRow(await ctx.call("access.shares_of", { resource: { type: "vault_folder", id: folderId } }));
      const shares = Array.isArray(got?.["shares"]) ? (got["shares"] as unknown[]) : [];
      for (const s of shares) {
        const row = asRow(s), grant = asRow(row?.["grant"]), subject = asRow(grant?.["subject"]);
        if (subject?.["kind"] !== "person") continue;
        if (row?.["through"] === "owner" || grant?.["level"] === "manage") out.add(String(subject["id"]));
      }
    } catch (e) {
      ctx.log.warn("vault request: the folder's shares could not be read", { folderId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (out.size === 0 || out.size === 1 && out.has(requester)) {
    // ruling 74: when no folder claims the key, the Space owner decides (the Space resource's owner, whatever the Space's roles are called)
    try {
      const got = asRow(await ctx.call("access.shares_of", { resource: { type: "space", id: ctx.space } }));
      const shares = Array.isArray(got?.["shares"]) ? (got["shares"] as unknown[]) : [];
      for (const s of shares) {
        const row = asRow(s), subject = asRow(asRow(row?.["grant"])?.["subject"]);
        if (row?.["through"] === "owner" && subject?.["kind"] === "person") out.add(String(subject["id"]));
      }
    } catch (e) {
      ctx.log.warn("vault request: the Space owner could not be read", { error: e instanceof Error ? e.message : String(e) });
    }
    for (const roleId of ["rol_owner", "rol_admin"]) {
      try {
        const got = asRow(await ctx.call("access.roles.get", { roleId }));
        const holders = Array.isArray(got?.["holders"]) ? (got["holders"] as unknown[]) : [];
        for (const h of holders) { const r = asRow(h); if (r?.["kind"] === "person") out.add(String(r["id"])); }
      } catch (e) {
        ctx.log.warn("vault request: the Space managers could not be read", { roleId, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  out.delete(requester);
  return [...out].sort();
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
  const block = { type: "vault_request", v: 1, data: { requestId: id, name, fields, reason: input.reason.trim(), requester, ...(input.forRun ? { forRun: input.forRun } : {}), ...(input.folderId ? { folderId: input.folderId } : {}), state: "waiting" } };
  const taskIds: string[] = [];
  for (const manager of managers) {
    const made = asRow(await ctx.call("tasks.create", {
      kind: "unblock", title: `The key ${name} is needed`, summary: input.reason.trim(), why: "A key is needed that only a manager of the Vault can supply.",
      assigned: { kind: "person", id: manager }, source: { kind: "manual", id }, blocks: [block],
      actions: [{ key: "fulfil", label: "Provide the key" }, { key: "decline", label: "Decline", note: "optional" }], idempotencyKey: `${id}:${manager}`,
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
  await ctx.call("vault.share", { resource: { type: "vault_item", id: itemId }, subject: { kind: row.requester_kind, id: row.requester_id }, level: "use", idempotencyKey: `${row.id}:use` });

  ctx.db.run(`UPDATE ${TABLE} SET state = ?, item_id = ?, decided_by = ?, decided_at = ? WHERE id = ?`, "fulfilled", itemId, me, ctx.now(), row.id);
  ctx.emit("vault.request_fulfilled", row.id, { requestId: row.id, itemId, ...(row.for_run ? { forRun: row.for_run } : {}) });
  await closeCards(ctx, row, "done", "Provided");
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
  await closeCards(ctx, row, "canceled", note ? `Declined: ${note}` : "Declined");
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
