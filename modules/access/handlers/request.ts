// Ask for access (spec 4.8, 2.3, ARCH 4.13): access.request, the requests list, approve and decline.
// A request grants nothing. It puts a Needs you card (an Unblock task holding the access_request block) in front of each person who may decide, and the grant exists
// only once one of them approves, as that person. Asking is a view-level act, so a view-only Ask thread can call it and still never reaches above view.
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { Level } from "../../../kernel/src/authorize/index.ts";
import { grantView, nid, page, raise, storeOf } from "../projections.ts";
import type { AccessCtx, AccessStore, GrantRec, ResourceRef } from "../projections.ts";

/** The part of the host Ctx these handlers use besides AccessCtx. */
export interface AskCtx extends AccessCtx {
  actingFor?: string;
  call(cap: string, input: unknown): Promise<unknown>;
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

const LEVELS: readonly Level[] = ["view", "use", "edit", "manage"];
const RANK: Record<string, number> = { view: 1, use: 2, edit: 3, manage: 4 };

export interface RequestRow {
  id: string; requester: string; resource_type: string; resource_id: string; level: Level; note: string | null; state: "waiting" | "granted" | "declined"; idem_key: string;
  approvers_json: string; task_ids_json: string; at: number; decided_by: string | null; decided_at: number | null; decision_note: string | null; grant_id: string | null;
}

/** The person a call is for: the signed-in person, or the person an agent acts for. */
export function personOf(ctx: AskCtx): string {
  if (ctx.principal.kind === "person") return ctx.principal.id;
  if (ctx.actingFor) return ctx.actingFor;
  return raise(ctx.trace.traceId, "permission.no_grant", "Only a person can ask for access.");
}

const asRow = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strOf = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export function requestOut(r: RequestRow) {
  const tasks = JSON.parse(r.task_ids_json) as string[];
  return {
    id: r.id, requester: r.requester, resource: { type: r.resource_type, id: r.resource_id }, level: r.level, ...(r.note ? { note: r.note } : {}),
    state: r.state, taskId: tasks[0] ?? "", at: r.at,
  };
}

export const requestById = (ctx: AccessCtx, id: string): RequestRow | undefined => ctx.db.all(`SELECT * FROM access_requests WHERE id = ?`, id)[0] as RequestRow | undefined;

function allows(ctx: AccessCtx, store: AccessStore, principal: string, perm: string | null, level: Level, resource: ResourceRef): boolean {
  return authorize(store.snapshot(), { principal, action: { perm, level }, resource, now: ctx.now() }).effect === "allow";
}

function activePeople(store: AccessStore): string[] {
  return [...store.principals.values()].filter((p) => p.kind === "person" && p.status === "active").map((p) => p.id).sort();
}

/** The admins: people whose roles carry access.manage. They decide requests for the Space, and stand in when a resource has no Manage holder. A role carries the permission for the whole Space, so the roles decide this, not a grant on one resource. */
export function adminsOf(_ctx: AccessCtx, store: AccessStore): string[] {
  const snap = store.snapshot();
  return activePeople(store).filter((id) => snap.info(id)?.perms.has("access.manage") === true);
}

/** Who may decide a request for this resource: its Manage holders, or the admins for the Space and when nobody holds Manage. The requester never decides their own. */
export function approversFor(ctx: AccessCtx, store: AccessStore, resource: ResourceRef, requester: string): string[] {
  const people = activePeople(store).filter((id) => id !== requester);
  const holders = resource.type === "space" ? [] : people.filter((id) => allows(ctx, store, id, null, "manage", resource));
  if (holders.length > 0) return holders;
  return adminsOf(ctx, store).filter((id) => id !== requester);
}

const titleOf = (store: AccessStore, resource: ResourceRef): string => {
  const row = store.resources.get(resource.id)?.row;
  return strOf(row?.["name"]) ?? strOf(row?.["title"]) ?? `${resource.type} ${resource.id}`;
};

export async function requestCreate(ctx: AskCtx, input: { resource: ResourceRef; level: Level; note?: string; idempotencyKey: string }) {
  const requester = personOf(ctx);
  const store = storeOf(ctx);
  if (!LEVELS.includes(input.level)) raise(ctx.trace.traceId, "validation.bad_input", "level is view, use, edit or manage");
  const roles = store.rolesOf(requester);
  if (roles.length > 0 && roles.every((r) => r === "rol_guest")) raise(ctx.trace.traceId, "permission.guest_cannot_request", "Guests work inside the access they were given and cannot ask for more.");

  const mine = (ctx.db.all(`SELECT * FROM access_requests WHERE requester = ?`, requester) as RequestRow[]);
  const again = mine.find((r) => r.idem_key === input.idempotencyKey);
  if (again) return { request: requestOut(again) };
  if (mine.some((r) => r.state === "waiting" && r.resource_type === input.resource.type && r.resource_id === input.resource.id)) {
    raise(ctx.trace.traceId, "validation.duplicate", "You already asked for access to this. The people who can decide have it.");
  }

  const approvers = approversFor(ctx, store, input.resource, requester);
  if (approvers.length === 0) raise(ctx.trace.traceId, "validation.precondition_failed", "Nobody can decide this request.");
  const id = nid("arq");
  const requesterName = store.principals.get(requester)?.name ?? requester;
  const resourceTitle = titleOf(store, input.resource);
  const block = {
    type: "access_request", v: 1,
    data: { requestId: id, requester, resource: { type: input.resource.type, id: input.resource.id }, resourceTitle, level: input.level, ...(input.note ? { note: input.note } : {}), state: "waiting" },
  };
  const taskIds: string[] = [];
  for (const approver of approvers) {
    const made = asRow(await ctx.call("tasks.create", {
      kind: "unblock", title: `${requesterName} asks for ${input.level} access to ${resourceTitle}`, ...(input.note ? { summary: input.note } : {}),
      why: "Someone is waiting on access only you can give.", assigned: { kind: "person", id: approver }, source: { kind: "manual", id },
      blocks: [block], actions: [{ key: "approve", label: "Approve" }, { key: "decline", label: "Decline", note: "optional" }], idempotencyKey: `${id}:${approver}`,
    }));
    const taskId = strOf(asRow(made?.["task"])?.["id"]);
    if (!taskId) raise(ctx.trace.traceId, "internal.unexpected", "The task for the request was not created.");
    taskIds.push(taskId);
  }
  const at = ctx.now();
  ctx.db.run(
    `INSERT INTO access_requests (id, requester, resource_type, resource_id, level, note, state, idem_key, approvers_json, task_ids_json, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, requester, input.resource.type, input.resource.id, input.level, input.note ?? null, "waiting", input.idempotencyKey, JSON.stringify(approvers), JSON.stringify(taskIds), at,
  );
  const row = requestById(ctx, id)!;
  ctx.emit("access.requested", id, { requestId: id, resource: { type: input.resource.type, id: input.resource.id }, level: input.level, requester, taskId: taskIds[0]! });
  return { request: requestOut(row) };
}

export async function requestsList(ctx: AskCtx, input: { mine?: boolean; state?: "waiting" | "granted" | "declined"; cursor?: string; limit?: number }) {
  const me = personOf(ctx);
  const all = (ctx.db.all(`SELECT * FROM access_requests`) as RequestRow[])
    .filter((r) => (input.mine ? r.requester === me : (JSON.parse(r.approvers_json) as string[]).includes(me)))
    .filter((r) => !input.state || r.state === input.state)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))
    .map(requestOut);
  const p = page(all, input.cursor, input.limit);
  return { requests: p.rows, total: p.total, ...(p.next ? { next: p.next } : {}) };
}

/** Load a waiting request the caller may decide. Anyone else gets "not found", so request ids leak nothing. */
function decidable(ctx: AskCtx, requestId: string): { row: RequestRow; me: string } {
  const me = personOf(ctx);
  const row = requestById(ctx, requestId);
  const store = storeOf(ctx);
  const may = row && ((JSON.parse(row.approvers_json) as string[]).includes(me) || (row.requester !== me && approversFor(ctx, store, { type: row.resource_type, id: row.resource_id }, row.requester).includes(me)));
  if (!row || !may) return raise(ctx.trace.traceId, "validation.not_found", "No such request.");
  if (row.state !== "waiting") return raise(ctx.trace.traceId, "validation.precondition_failed", `This request was already ${row.state}.`);
  return { row, me };
}

/** Close the cards of a decided request for everyone who held one. A card that cannot close is logged; the decision stands. */
async function closeCards(ctx: AskCtx, row: RequestRow, to: "done" | "canceled", note: string): Promise<void> {
  for (const taskId of JSON.parse(row.task_ids_json) as string[]) {
    try {
      await ctx.call("tasks.transition", { taskId, to, note });
    } catch (e) {
      ctx.log.warn("access request card did not close", { requestId: row.id, taskId, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export async function requestsApprove(ctx: AskCtx, input: { requestId: string; level?: Level }) {
  const { row, me } = decidable(ctx, input.requestId);
  const store = storeOf(ctx);
  const level = input.level ?? row.level;
  if (!LEVELS.includes(level)) raise(ctx.trace.traceId, "validation.bad_input", "level is view, use, edit or manage");
  const resource = { type: row.resource_type, id: row.resource_id };
  // a delegated grant stays inside the approver's own: a Manage holder may give any level, an admin deciding for the Space gives what the request asked
  const ownLevel = resource.type === "space" || allows(ctx, store, me, null, "manage", resource) ? 4 : LEVELS.reduce((best, l) => (allows(ctx, store, me, null, l, resource) ? Math.max(best, RANK[l]!) : best), 0);
  if (RANK[level]! > ownLevel) raise(ctx.trace.traceId, "permission.not_contained", "You cannot give more access than you hold yourself.");

  const grant: GrantRec = {
    id: nid("gnt"), subject: { kind: "person", id: row.requester }, resource, level, conditions: {}, by: me, source: `request:${row.id}`, createdAt: ctx.now(),
  };
  store.grants.set(grant.id, grant);
  store.bump();
  ctx.emit("grant.created", grant.id, { grantId: grant.id, subject: grant.subject, resource, level, source: grant.source });
  ctx.emit("access.changed", String(store.epoch), { epoch: store.epoch, what: "assignment", by: me });
  try { store.persist(ctx.db); } catch (e) { store.grants.delete(grant.id); store.bump(); throw e; }
  ctx.db.run(`UPDATE access_requests SET state = ?, decided_by = ?, decided_at = ?, grant_id = ? WHERE id = ?`, "granted", me, ctx.now(), grant.id, row.id);
  ctx.emit("access.granted", row.id, { requestId: row.id, resource, level, requester: row.requester, grantId: grant.id });
  await closeCards(ctx, row, "done", "Approved");
  return { grant: grantView(grant) };
}

export async function requestsDecline(ctx: AskCtx, input: { requestId: string; note?: string }) {
  const { row, me } = decidable(ctx, input.requestId);
  ctx.db.run(`UPDATE access_requests SET state = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`, "declined", me, ctx.now(), input.note ?? null, row.id);
  ctx.emit("access.declined", row.id, { requestId: row.id, resource: { type: row.resource_type, id: row.resource_id }, requester: row.requester, ...(input.note ? { note: input.note } : {}) });
  await closeCards(ctx, row, "canceled", input.note ? `Declined: ${input.note}` : "Declined");
  return { ok: true };
}
