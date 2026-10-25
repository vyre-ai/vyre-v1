// Handler table of the conflicts module: all 11 capabilities of manifests/conflicts.ts. Reads are the caller's own conflicts; the writes are in detect.ts and resolve.ts.
// The module's `status` in host/modules.json is flipped by this lane's live packet (ruling 25).
import { assist, logBinary, propose } from "./detect.ts";
import { confirm, owned, redo, resolve, undo } from "./resolve.ts";
import { actorOf, ensure, listConflicts, loadConflict, num, pageOf, raise, rowsOf, fromJson, toContractRow } from "../projections.ts";
import type { CfCtx, State } from "../projections.ts";

type Page = { cursor?: string; limit?: number };

function list(ctx: CfCtx, input: { state?: State[]; entity?: string; since?: number } & Page) {
  ensure(ctx.db);
  const all = listConflicts(ctx.db, actorOf(ctx), {
    ...(input.state ? { states: input.state } : {}), ...(input.entity ? { entity: input.entity } : {}), ...(input.since !== undefined ? { since: input.since } : {}),
  });
  const p = pageOf(all, input.cursor, input.limit);
  return { conflicts: p.page.map((c) => toContractRow(ctx.db, c)), ...(p.next ? { next: p.next } : {}), total: p.total };
}

function get(ctx: CfCtx, input: { conflictId: string }) {
  ensure(ctx.db);
  const c = loadConflict(ctx.db, input.conflictId);
  if (!c) raise(ctx, "validation.not_found", "That conflict does not exist.", { conflictId: input.conflictId });
  owned(ctx, c);
  return { conflict: toContractRow(ctx.db, c) };
}

/** Open means the assistant has not settled it yet (open or proposed); needs you waits on the person. */
function counts(ctx: CfCtx) {
  ensure(ctx.db);
  const rows = rowsOf(ctx.db, "SELECT state, count(*) AS n FROM conflicts_conflict WHERE person = ? GROUP BY state", actorOf(ctx));
  const n = (s: string): number => num(rows.find((r) => r["state"] === s)?.["n"]);
  return { open: n("open") + n("proposed"), needsYou: n("needs_you"), resolved: n("resolved") };
}

function fieldHistory(ctx: CfCtx, input: { entity: string; recordId: string; field: string }) {
  ensure(ctx.db);
  const rows = rowsOf(
    ctx.db, "SELECT value, hlc, actor, reason, at FROM conflicts_history WHERE entity = ? AND record_id = ? AND field = ? ORDER BY at DESC, hlc DESC",
    input.entity, input.recordId, input.field,
  );
  // Seeing a field's past values takes the same access as seeing the field.
  const d = ctx.authorize({ perm: null, level: "view" }, { type: "record", id: input.recordId });
  if (d.effect === "deny") raise(ctx, "permission.no_grant", "You cannot see this item, so you cannot see its history.", { entity: input.entity });
  return { entries: rows.map((r) => ({ value: fromJson(r["value"]), hlc: String(r["hlc"]), actor: String(r["actor"]), reason: String(r["reason"]), at: num(r["at"]) })) };
}

export const handlers = {
  "conflicts.list": list,
  "conflicts.get": get,
  "conflicts.counts": counts,
  "conflicts.field_history": fieldHistory,
  "conflicts.assist": assist,
  "conflicts.propose": propose,
  "conflicts.resolve": resolve,
  "conflicts.confirm": confirm,
  "conflicts.undo": undo,
  "conflicts.redo": redo,
  "conflicts.log_binary": logBinary,
};

