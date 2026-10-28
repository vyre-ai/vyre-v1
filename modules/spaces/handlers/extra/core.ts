// The eight spaces capabilities that had no packet: spaces.get, spaces.update, spaces.matrix, spaces.export, spaces.leave,
// spaces.transfer_ownership, spaces.delete and spaces.switch_address (spec 2.1, 3.13; ARCH 7.0, 7.13). The switcher tile, stars, follows and the
// first-run checklist are P-L7_07's; the host wires these over the `later` stubs in handlers/index.ts when it flips spaces live (P-L7_LIVE).
//
// The profile name, logo and kind live in spaces_profile (P-L7_07). What only these capabilities need (legal name, defaults, the address, when the
// Space was made, when it was deleted) lives in spaces_profile_extra. The tables are created here with CREATE TABLE IF NOT EXISTS, with the same columns
// as P-L7_07's migration, so whichever runs first wins and the other is a no-op.
//
// The host supplies, through configureSpaceAdmin, what a module cannot know: who the owner is, the Space key fingerprint, how the address is applied,
// how ownership moves in the access projection and how the data is removed. Nothing here imports node:crypto or node:sqlite.

import type { Ctx } from "../../../../packages/contracts/src/ctx.ts";
import { ERROR_CODES, VyreErr } from "../../../../packages/contracts/src/errors.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../../packages/contracts/src/types.ts";

/** The part of the host Ctx these handlers use. The full Ctx satisfies it. */
export type ExtraCtx = Pick<Ctx, "space" | "principal" | "actingFor" | "trace" | "now" | "db" | "emit" | "call">;

// ---- tables

export const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS spaces_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_file_id TEXT,
  kind TEXT NOT NULL
)`,
  // legal_name is shown to outsiders; defaults_json holds the Space defaults; address_mode is relay, own_domain or device; deleted_at is set when the owner deletes the Space
  `CREATE TABLE IF NOT EXISTS spaces_profile_extra (
  id TEXT PRIMARY KEY,
  legal_name TEXT,
  defaults_json TEXT NOT NULL,
  address_mode TEXT NOT NULL,
  address_host TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
)`,
];

// ---- the drivers the host supplies

export interface SpaceAdminDrivers {
  /** The user id of the Owner. */
  owner(): Promise<string>;
  /** The Space key fingerprint devices pin, in the "ab12 cd34 ef56 7890" form. */
  fingerprint(): Promise<string>;
  /** Is this person an active member? */
  isMember(personId: string): Promise<boolean>;
  /** Make `to` the Owner and `from` an Admin in the access projection. Resolves with the new authorize epoch. */
  transferOwner(from: string, to: string): Promise<{ epoch: number }>;
  /** Point the Space at the relay or at an own domain (the Caddy and relay settings). The Space key does not change. */
  applyAddress(mode: "relay" | "own_domain", host: string | null): Promise<void>;
  /** Current host-observed ingress, when running on a server with a network driver. */
  address?(): Promise<{mode: "relay" | "own_domain"; host?: string} | undefined>;
  /** Remove the Space's data and stop serving it. Called once, after the name was typed correctly. */
  deleteSpace(): Promise<void>;
  /** Where the Space runs ("Vyre Server on a Mac mini", "Railway"), when the host knows. */
  hostedOn?(): Promise<string | undefined>;
  /** When the Space was made, when the host knows (otherwise the first time this profile was read). */
  createdAt?(): Promise<number | undefined>;
}

let drivers: SpaceAdminDrivers | null = null;
/** Wire (or, with null, unwire) the host drivers. */
export function configureSpaceAdmin(d: SpaceAdminDrivers | null): void {
  drivers = d;
}

// ---- errors and small readers

const NEXT_LABEL: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Use another model", use_backup_key: "Use the backup key", ask_access: "Ask for access",
  open_settings: "Open settings", reconnect: "Reconnect", edit_input: "Change what you sent", wait: "Wait a moment",
  contact_admin: "Contact an admin", report: "Report a problem",
};

/** Throw a typed error from the global catalogue with the trace id and the catalogue's next steps. */
export function failWith(traceId: string, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT_LABEL[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

type Row = Record<string, unknown>;
const asRow = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function need(ctx: ExtraCtx): SpaceAdminDrivers {
  if (!drivers) return failWith(ctx.trace.traceId, "internal.unavailable", "Space administration is not available on this server yet.", { service: "space-admin" });
  return drivers;
}

function ensureSchema(ctx: ExtraCtx): void {
  for (const sql of SCHEMA) ctx.db.run(sql);
}

// ---- the profile

export type Kind = "personal" | "team";
export type AddressMode = "relay" | "own_domain" | "device";

export interface Profile {
  id: string;
  name: string;
  legalName?: string;
  logoFileId?: string;
  kind: Kind;
  address: { mode: AddressMode; host?: string };
  defaults: Record<string, unknown>;
  createdAt: number;
  deletedAt?: number;
}

export const NAME_MAX = 120;
export const LEGAL_NAME_MAX = 200;
export const DEFAULTS_MAX_KEYS = 50;
export const DEFAULTS_MAX_BYTES = 16 * 1024;

function readProfile(ctx: ExtraCtx): Profile {
  ensureSchema(ctx);
  const base = asRow(ctx.db.all("SELECT * FROM spaces_profile WHERE id = ?", ctx.space)[0]);
  const name = str(base?.["name"]);
  if (!base || !name) return failWith(ctx.trace.traceId, "validation.not_found", "This Space has no profile yet.");
  const kind: Kind = base["kind"] === "personal" ? "personal" : "team";
  let extra = asRow(ctx.db.all("SELECT * FROM spaces_profile_extra WHERE id = ?", ctx.space)[0]);
  if (!extra) {
    ctx.db.run(
      "INSERT INTO spaces_profile_extra (id, legal_name, defaults_json, address_mode, address_host, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ctx.space, null, "{}", kind === "personal" ? "device" : "relay", null, ctx.now(), null,
    );
    extra = asRow(ctx.db.all("SELECT * FROM spaces_profile_extra WHERE id = ?", ctx.space)[0]);
  }
  let defaults: Record<string, unknown> = {};
  try { defaults = asRow(JSON.parse(String(extra?.["defaults_json"] ?? "{}"))) ?? {}; } catch { defaults = {}; }
  const mode = extra?.["address_mode"];
  const host = str(extra?.["address_host"]);
  const legalName = str(extra?.["legal_name"]), logoFileId = str(base["logo_file_id"]);
  const deletedAt = typeof extra?.["deleted_at"] === "number" ? extra["deleted_at"] : undefined;
  return {
    id: ctx.space, name, ...(legalName ? { legalName } : {}), ...(logoFileId ? { logoFileId } : {}), kind,
    address: { mode: mode === "relay" || mode === "own_domain" || mode === "device" ? mode : kind === "personal" ? "device" : "relay", ...(host ? { host } : {}) },
    defaults, createdAt: typeof extra?.["created_at"] === "number" ? extra["created_at"] : ctx.now(), ...(deletedAt !== undefined ? { deletedAt } : {}),
  };
}

async function spaceRow(ctx: ExtraCtx, p: Profile) {
  const d = need(ctx);
  const [owner, fingerprint, hostedOn, madeAt, observedAddress] = await Promise.all([d.owner(), d.fingerprint(), d.hostedOn?.(), d.createdAt?.(), p.kind === 'personal' ? undefined : d.address?.()]);
  return {
    id: p.id, name: p.name, ...(p.legalName ? { legalName: p.legalName } : {}), ...(p.logoFileId ? { logoFileId: p.logoFileId } : {}), kind: p.kind, owner, fingerprint,
    address: observedAddress ?? p.address, ...(hostedOn ? { hostedOn } : {}), defaults: p.defaults, createdAt: madeAt ?? p.createdAt,
  };
}

function live(ctx: ExtraCtx): Profile {
  const p = readProfile(ctx);
  if (p.deletedAt !== undefined) return failWith(ctx.trace.traceId, "validation.not_found", "This Space was deleted.");
  return p;
}

const isOwner = async (ctx: ExtraCtx): Promise<boolean> => ctx.principal.kind === "person" && ctx.principal.id === (await need(ctx).owner());

// ---- handlers

export async function get(ctx: ExtraCtx, _input: Record<string, unknown>) {
  return { space: await spaceRow(ctx, live(ctx)) };
}

export async function update(ctx: ExtraCtx, input: { name?: string; legalName?: string; logoFileId?: string | null; defaults?: Record<string, unknown> }) {
  const p = live(ctx);
  const fields: string[] = [];
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 1 || name.length > NAME_MAX) return failWith(ctx.trace.traceId, "validation.bad_input", `The name is 1 to ${NAME_MAX} characters.`, { errors: ["name: length"] });
    if (name !== p.name) { ctx.db.run("UPDATE spaces_profile SET name = ? WHERE id = ?", name, ctx.space); fields.push("name"); }
  }
  if (input.legalName !== undefined) {
    const legal = input.legalName.trim();
    if (legal.length > LEGAL_NAME_MAX) return failWith(ctx.trace.traceId, "validation.bad_input", `The legal name is at most ${LEGAL_NAME_MAX} characters.`, { errors: ["legalName: length"] });
    if (legal !== (p.legalName ?? "")) { ctx.db.run("UPDATE spaces_profile_extra SET legal_name = ? WHERE id = ?", legal.length > 0 ? legal : null, ctx.space); fields.push("legalName"); }
  }
  if (input.logoFileId !== undefined) {
    if (input.logoFileId !== (p.logoFileId ?? null)) { ctx.db.run("UPDATE spaces_profile SET logo_file_id = ? WHERE id = ?", input.logoFileId, ctx.space); fields.push("logoFileId"); }
  }
  if (input.defaults !== undefined) {
    // a merge: a key set to null is removed, any other value replaces the old one
    const merged: Record<string, unknown> = { ...p.defaults };
    for (const [k, v] of Object.entries(input.defaults)) { if (v === null) delete merged[k]; else merged[k] = v; }
    const json = JSON.stringify(merged);
    if (Object.keys(merged).length > DEFAULTS_MAX_KEYS || json.length > DEFAULTS_MAX_BYTES) {
      return failWith(ctx.trace.traceId, "validation.too_large", `The defaults are at most ${DEFAULTS_MAX_KEYS} keys and ${DEFAULTS_MAX_BYTES / 1024} KB.`);
    }
    if (json !== JSON.stringify(p.defaults)) { ctx.db.run("UPDATE spaces_profile_extra SET defaults_json = ? WHERE id = ?", json, ctx.space); fields.push("defaults"); }
  }
  if (fields.length > 0) ctx.emit("space.updated" as never, `entity/${ctx.principal.id}`, { fields, by: ctx.principal.id });
  return { space: await spaceRow(ctx, readProfile(ctx)) };
}

/** Features the Personal Space does not have (spec 2.1): public apps, campaign sending, the Console, agent computers, webhooks, always-on runs, and the two that need other people. */
export const TEAM_ONLY = ["apps_public", "campaign_sending", "console", "agent_computers", "webhooks", "always_on_runs", "sharing", "members"] as const;
export const TEAM_LINE = "Needs a Team Space";

export async function matrix(ctx: ExtraCtx, _input: Record<string, unknown>) {
  const p = live(ctx);
  return {
    kind: p.kind,
    features: TEAM_ONLY.map((key) => (p.kind === "team" ? { key, available: true } : { key, available: false, line: TEAM_LINE })),
  };
}

/** The owner's export is the Space-wide export of the backup module: one zip, never secret values, never other people's private chats or personal memory. */
export async function exportAll(ctx: ExtraCtx, input: { idempotencyKey?: string }) {
  live(ctx);
  const out = asRow(await ctx.call("backup.export_start" as never, { idempotencyKey: `spaces.export:${input.idempotencyKey ?? ctx.trace.traceId}` }));
  const runId = str(out?.["runId"]);
  if (!runId) return failWith(ctx.trace.traceId, "internal.unexpected", "The export did not start.");
  return { runId };
}

export async function leave(ctx: ExtraCtx, input: { confirm: boolean }) {
  const d = need(ctx);
  live(ctx);
  if (input.confirm !== true) return failWith(ctx.trace.traceId, "validation.bad_input", "Confirm that you want to leave.");
  if (ctx.principal.kind !== "person") return failWith(ctx.trace.traceId, "validation.precondition_failed", "Only a person can leave a Space.");
  const me = ctx.principal.id;
  if (me === (await d.owner())) return failWith(ctx.trace.traceId, "validation.precondition_failed", "You own this Space. Hand it to someone else first, or delete it.");
  // devices purge and the Space key epoch rotates on member.removed; the principal stops being served on principal.suspended
  ctx.emit("member.removed" as never, `entity/${me}`, { personId: me, by: me, reason: "left" });
  ctx.emit("principal.suspended" as never, `entity/${me}`, { principalId: me, reason: "left" });
  return { ok: true };
}

export async function transferOwnership(ctx: ExtraCtx, input: { to: string }) {
  const d = need(ctx);
  live(ctx);
  const from = await d.owner();
  if (!(await isOwner(ctx))) return failWith(ctx.trace.traceId, "permission.role_lacks_permission", "Only the owner can hand the Space to someone else.");
  if (input.to === from) return failWith(ctx.trace.traceId, "validation.precondition_failed", "You already own this Space.");
  if (!(await d.isMember(input.to))) return failWith(ctx.trace.traceId, "validation.precondition_failed", "Hand the Space to someone who has joined it.", { to: input.to });
  const { epoch } = await d.transferOwner(from, input.to);
  ctx.emit("space.ownership_transferred" as never, `entity/${input.to}`, { from, to: input.to });
  ctx.emit("access.changed" as never, `entity/${epoch}`, { epoch, what: "assignment", by: from });
  return { ok: true };
}

export async function deleteSpace(ctx: ExtraCtx, input: { confirmName: string }) {
  const d = need(ctx);
  const p = live(ctx);
  if (!(await isOwner(ctx))) return failWith(ctx.trace.traceId, "permission.role_lacks_permission", "Only the owner can delete the Space.");
  // the name outsiders see is the one to type; a Space without a legal name asks for its name
  const expected = p.legalName ?? p.name;
  if (input.confirmName !== expected) return failWith(ctx.trace.traceId, "validation.precondition_failed", `Type ${expected} exactly to delete this Space.`);
  await d.deleteSpace();
  ctx.db.run("UPDATE spaces_profile_extra SET deleted_at = ? WHERE id = ?", ctx.now(), ctx.space);
  ctx.emit("space.deleted" as never, `entity/${ctx.principal.id}`, { by: ctx.principal.id });
  return { ok: true };
}

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function switchAddress(ctx: ExtraCtx, input: { mode: "relay" | "own_domain"; host?: string }) {
  const d = need(ctx);
  const p = live(ctx);
  if (p.kind === "personal") return failWith(ctx.trace.traceId, "permission.needs_team", "A Personal Space lives on this computer and is reached through the relay; it has no address to move.");
  let host: string | null = null;
  if (input.mode === "own_domain") {
    host = (input.host ?? "").trim().toLowerCase();
    if (!HOST.test(host)) return failWith(ctx.trace.traceId, "validation.bad_input", "Use a domain name like team.example.com.", { errors: ["host: not a domain name"] });
  }
  const currentAddress = await d.address?.() ?? p.address;
  const same = currentAddress.mode === input.mode && (input.mode === "relay" || (currentAddress.host ?? null) === host);
  if (!same) {
    await d.applyAddress(input.mode, host);
    ctx.db.run("UPDATE spaces_profile_extra SET address_mode = ?, address_host = ? WHERE id = ?", input.mode, host, ctx.space);
    ctx.emit("space.address_changed" as never, `entity/${input.mode}`, { mode: input.mode, ...(host ? { host } : {}), by: ctx.principal.id });
  }
  // the Space key and its fingerprint do not change, so every device that pinned it keeps working and nobody is invited again
  return { space: await spaceRow(ctx, readProfile(ctx)) };
}
