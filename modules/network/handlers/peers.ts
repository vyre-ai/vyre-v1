// The computers of one Personal Space (lane l-multidevice). The host daemon (host/src/peers) writes network_peer, network_peer_request and network_peer_self; these handlers read them for
// Settings, Computers, and record the person's answer to a new computer that asks to use this Personal Space. The host hands the Space to that computer only after `allowed`.
import { asRow, failWith } from "./status.ts";
import type { NetworkCtx } from "./status.ts";

/** A computer that has not been heard from in this long reads as asleep. The host refreshes last_seen_at every minute while two computers are connected. */
export const PEER_AWAKE_MS = 3 * 60_000;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : undefined);

function selfId(ctx: NetworkCtx): string | null {
  const r = asRow(ctx.db.all("SELECT peer_id FROM network_peer_self WHERE id = 1")[0]);
  return r ? str(r["peer_id"]) || null : null;
}

export async function peers(ctx: NetworkCtx, _input: Record<string, unknown>) {
  const me = selfId(ctx);
  const now = ctx.now();
  const mine = asRow(ctx.db.all("SELECT waiting, synced_at FROM network_peer_self WHERE id = 1")[0]);
  const syncedAt = num(mine?.["synced_at"]);
  const rows = ctx.db.all("SELECT id, name, platform, kind, added_at, last_seen_at FROM network_peer WHERE removed_at IS NULL ORDER BY added_at, id").map(asRow);
  return {
    waiting: num(mine?.["waiting"]) ?? 0, ...(syncedAt !== undefined ? { syncedAt } : {}),
    computers: rows.map((r) => {
      const id = str(r?.["id"]);
      const self = id === me;
      const seen = num(r?.["last_seen_at"]);
      return {
        peerId: id, name: str(r?.["name"]) || "Computer", platform: str(r?.["platform"]), kind: str(r?.["kind"]) === "server" ? "server" as const : "computer" as const,
        self, online: self || (seen !== undefined && now - seen < PEER_AWAKE_MS), ...(seen !== undefined ? { lastSeenAt: seen } : {}), addedAt: num(r?.["added_at"]) ?? 0,
      };
    }),
  };
}

export async function peerRequests(ctx: NetworkCtx, _input: Record<string, unknown>) {
  const now = ctx.now();
  const rows = ctx.db.all("SELECT id, name, platform, code, created_at, expires_at FROM network_peer_request WHERE state = 'pending' AND expires_at > ? ORDER BY created_at", now).map(asRow);
  return { requests: rows.map((r) => ({ requestId: str(r?.["id"]), name: str(r?.["name"]) || "A computer", platform: str(r?.["platform"]), code: str(r?.["code"]), requestedAt: num(r?.["created_at"]) ?? 0, expiresAt: num(r?.["expires_at"]) ?? 0 })) };
}

function pending(ctx: NetworkCtx, requestId: string) {
  const r = asRow(ctx.db.all("SELECT id, state, expires_at FROM network_peer_request WHERE id = ?", requestId)[0]);
  if (!r) failWith(ctx.trace.traceId, "validation.not_found", "That request is gone. Ask again from the new computer.", { requestId });
  if (str(r["state"]) !== "pending" || (num(r["expires_at"]) ?? 0) <= ctx.now()) failWith(ctx.trace.traceId, "validation.precondition_failed", "That request has ended. Ask again from the new computer.", { requestId });
  return r;
}

const personOnly = (ctx: NetworkCtx): string => {
  if (ctx.principal.kind !== "person") failWith(ctx.trace.traceId, "permission.denied", "Only you can let a computer use your Personal Space.");
  return ctx.principal.id;
};

export async function peerAllow(ctx: NetworkCtx, input: { requestId: string }) {
  const who = personOnly(ctx);
  pending(ctx, input.requestId);
  ctx.db.run("UPDATE network_peer_request SET state = 'allowed', decided_by = ?, decided_at = ? WHERE id = ? AND state = 'pending'", who, ctx.now(), input.requestId);
  return { state: "allowed" as const };
}

export async function peerDecline(ctx: NetworkCtx, input: { requestId: string }) {
  const who = personOnly(ctx);
  pending(ctx, input.requestId);
  ctx.db.run("UPDATE network_peer_request SET state = 'declined', decided_by = ?, decided_at = ? WHERE id = ? AND state = 'pending'", who, ctx.now(), input.requestId);
  return { state: "declined" as const };
}

/** Take a computer out of this Personal Space: its token stops working on every computer once the change reaches it. It cannot be this computer. */
export async function peerRemove(ctx: NetworkCtx, input: { peerId: string }) {
  personOnly(ctx);
  if (input.peerId === selfId(ctx)) failWith(ctx.trace.traceId, "validation.precondition_failed", "This is the computer you are using. Remove it from another one.");
  const r = asRow(ctx.db.all("SELECT id FROM network_peer WHERE id = ? AND removed_at IS NULL", input.peerId)[0]);
  if (!r) return { removed: false };
  ctx.db.run("UPDATE network_peer SET removed_at = ?, token_hash = ? WHERE id = ?", ctx.now(), null, input.peerId);
  return { removed: true };
}

/** What syncing between this Space's computers had to settle here: a name made on two computers while apart (one copy renamed), or a row kept aside whole. Newest first. */
export async function peerConflicts(ctx: NetworkCtx, _input: Record<string, unknown>) {
  const rows = ctx.db.all("SELECT id, tbl, row_key, kind, detail, at FROM network_peer_conflict ORDER BY at DESC LIMIT 100").map(asRow);
  return { conflicts: rows.map((r) => ({ conflictId: str(r?.["id"]), table: str(r?.["tbl"]), rowKey: str(r?.["row_key"]), kind: str(r?.["kind"]) === "kept_aside" ? "kept_aside" as const : "renamed" as const, detail: str(r?.["detail"]), at: num(r?.["at"]) ?? 0 })) };
}

/** Where scheduled work runs now: the computer holding the lease, and until when. */
export async function peerRunner(ctx: NetworkCtx, _input: Record<string, unknown>) {
  const r = asRow(ctx.db.all("SELECT peer_id, expires_at FROM network_runner WHERE id = 'scheduled'")[0]);
  const me = selfId(ctx);
  if (!r) return { here: true };
  const holder = str(r["peer_id"]);
  return { peerId: holder, here: holder === me && (num(r["expires_at"]) ?? 0) > ctx.now(), expiresAt: num(r["expires_at"]) ?? 0 };
}
