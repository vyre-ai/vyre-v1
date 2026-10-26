// Devices projections: devices, sessions and epochs (spec 2.25, ARCH 4.1, 5.7).
// A revoked device ends its sessions and bumps the person's epoch; its client sees `revoked` in devices.epoch on next contact, purges, and acks. Other live devices of
// the person catch up to the new epoch (their keys are re-wrapped), so only the revoked one is cut off. Handlers reach the tables only through ctx.db.
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { fail } from "../../host/src/routes/errors.ts";

/** The part of the host Ctx these handlers use. The full Ctx satisfies it. */
export type DevicesCtx = Pick<Ctx, "space" | "principal" | "trace" | "now" | "db" | "emit" | "authorize" | "device"> & { depth?: number };

export type DeviceClass = "desktop" | "phone" | "web" | "extension" | "daemon";
export type EpochReason = "device_revoked" | "suspended" | "removed" | "password_reset" | "clearance_lowered" | "key_rotation";
export interface DeviceRec {
  id: string; person: string; name: string; class: DeviceClass; epoch: number;
  lastSeenAt: number | null; location: string | null; revokedAt: number | null; version: number; deleted_at: number | null;
}
export interface SessionRec {
  id: string; person: string; kind: "device" | "agent_run"; principal_kind: string; device_id: string | null;
  started_at: number; last_seen_at: number; location: string | null; revoked_at: number | null;
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: Pick<DevicesCtx, "trace">, code: Code, message?: string): never {
  throw fail(code, ctx.trace.traceId, message ? { message } : {});
}
export function nid(prefix: string): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}_${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
export const PAGE_DEFAULT = 100;
export const PAGE_MAX = 500;

// ---- who is asking

export function me(ctx: DevicesCtx): string {
  if (!ctx.principal || ctx.principal.kind !== "person") raise(ctx, "auth.unauthenticated");
  return ctx.principal.id;
}
export function isAdmin(ctx: DevicesCtx): boolean {
  return ctx.authorize({ perm: "access.manage", level: "view" }, { type: "space", id: ctx.space }).effect === "allow";
}
/** Own things, or anything with access.manage. */
export function mayTouch(ctx: DevicesCtx, person: string): boolean {
  return (ctx.principal?.kind === "person" && ctx.principal.id === person) || isAdmin(ctx);
}
const byOf = (ctx: DevicesCtx): string => ctx.principal?.id ?? "system";

// ---- rows to API shapes

export function deviceOut(r: DeviceRec, current: string | undefined) {
  return {
    id: r.id, person: r.person, name: r.name, class: r.class, epoch: r.epoch,
    ...(r.lastSeenAt !== null ? { lastSeenAt: r.lastSeenAt } : {}), ...(r.location ? { location: r.location } : {}),
    ...(r.revokedAt !== null ? { revokedAt: r.revokedAt } : {}), ...(current !== undefined ? { current: r.id === current } : {}),
  };
}
export function sessionOut(r: SessionRec, current: string | undefined) {
  return {
    id: r.id, principal: { kind: r.principal_kind as "person" | "agent" | "actor" | "service", id: r.person }, ...(r.device_id ? { deviceId: r.device_id } : {}), kind: r.kind,
    startedAt: r.started_at, lastSeenAt: r.last_seen_at, ...(r.location ? { location: r.location } : {}),
    ...(current !== undefined && r.device_id !== null ? { current: r.device_id === current } : {}),
  };
}

// ---- reads

export function deviceById(ctx: DevicesCtx, id: string): DeviceRec | undefined {
  return ctx.db.all(`SELECT * FROM devices_device WHERE id = ? AND deleted_at IS NULL`, id)[0] as DeviceRec | undefined;
}
export function mustDevice(ctx: DevicesCtx, id: string): DeviceRec {
  const d = deviceById(ctx, id);
  // a device that is not yours reads as missing unless you may manage access
  if (!d || !mayTouch(ctx, d.person)) raise(ctx, "validation.not_found", "no such device");
  return d;
}
export function devicesOf(ctx: DevicesCtx, person: string, live: boolean): DeviceRec[] {
  const rows = ctx.db.all(`SELECT * FROM devices_device WHERE person = ? AND deleted_at IS NULL ORDER BY lastSeenAt DESC, id DESC`, person) as DeviceRec[];
  return live ? rows.filter((r) => r.revokedAt === null) : rows;
}
export function sessionsOf(ctx: DevicesCtx, person: string): SessionRec[] {
  return (ctx.db.all(`SELECT * FROM devices_session WHERE person = ? AND revoked_at IS NULL ORDER BY started_at DESC, id DESC`, person) as SessionRec[]);
}
export function sessionsOfDevice(ctx: DevicesCtx, deviceId: string): SessionRec[] {
  return ctx.db.all(`SELECT * FROM devices_session WHERE device_id = ? AND revoked_at IS NULL ORDER BY started_at DESC, id DESC`, deviceId) as SessionRec[];
}

export function pageOf<T>(rows: T[], cursor: string | undefined, limit: number | undefined): { items: T[]; next?: string; total: number } {
  const start = cursor !== undefined && /^[0-9]+$/.test(cursor) ? Number(cursor) : 0;
  const size = Math.min(PAGE_MAX, Math.max(1, limit ?? PAGE_DEFAULT));
  const items = rows.slice(start, start + size);
  return { items, ...(start + size < rows.length ? { next: String(start + size) } : {}), total: rows.length };
}

// ---- epochs

export function epochOf(ctx: DevicesCtx, scope: string): number {
  const r = ctx.db.all(`SELECT epoch FROM devices_epoch WHERE scope = ?`, scope)[0] as { epoch: number } | undefined;
  return r?.epoch ?? 0;
}
export function bumpEpoch(ctx: DevicesCtx, scope: "space" | "person", person: string | undefined, reason: EpochReason): number {
  const key = scope === "space" ? "space" : `person:${person}`;
  const cur = ctx.db.all(`SELECT epoch FROM devices_epoch WHERE scope = ?`, key)[0] as { epoch: number } | undefined;
  const next = (cur?.epoch ?? 0) + 1;
  if (cur) ctx.db.run(`UPDATE devices_epoch SET epoch = ? WHERE scope = ?`, next, key);
  else ctx.db.run(`INSERT INTO devices_epoch (scope, epoch) VALUES (?, ?)`, key, next);
  ctx.emit("epoch.bumped", scope === "space" ? "space" : person!, { scope, ...(person ? { person } : {}), epoch: next, reason });
  return next;
}

// ---- writes

export function endSession(ctx: DevicesCtx, s: SessionRec): void {
  ctx.db.run(`UPDATE devices_session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, ctx.now(), s.id);
  ctx.emit("session.revoked", s.id, { sessionId: s.id, person: s.person, by: byOf(ctx) });
}

/** Revoke one device: stop its sessions, cut it off, bump the person's epoch and move the person's other live devices up to it. Returns false when it was already revoked. */
export function revokeDevice(ctx: DevicesCtx, d: DeviceRec): boolean {
  if (d.revokedAt !== null) return false;
  const now = ctx.now();
  ctx.db.run(`UPDATE devices_device SET revokedAt = ?, version = ?, updated_at = ? WHERE id = ?`, now, d.version + 1, now, d.id);
  ctx.emit("device.revoked", d.id, { deviceId: d.id, person: d.person, by: byOf(ctx) });
  for (const s of sessionsOfDevice(ctx, d.id)) endSession(ctx, s);
  const epoch = bumpEpoch(ctx, "person", d.person, "device_revoked");
  for (const o of devicesOf(ctx, d.person, true)) {
    if (o.id !== d.id) ctx.db.run(`UPDATE devices_device SET epoch = ?, version = ?, updated_at = ? WHERE id = ?`, epoch, o.version + 1, now, o.id);
  }
  return true;
}
