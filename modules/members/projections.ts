import type {SignInMethods} from "../../lib/sign-in-policy.ts";
// Members projections (spec 3.13, 3.10, 2.1, ARCH 7.13, 7.10): invites, the join effects, suspend and remove state, sign-in policy and SSO rows.
// Durable tables: migrations/0001_members.sql. Handlers reach them only through ctx.db (members_* only, ARCH B2).
// Other modules are reached through ctx.call (access, devices, spaces, projects, channels) or through the optional seams below,
// which the host builds from those modules the way it builds identity's ctx.invites. Modules never import each other (B1).
import { sha256b64 } from "../../kernel/src/seal/wire.ts";
import { fail } from "../../host/src/routes/errors.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export type RemovalKind =
  | "routines" | "automations" | "agents" | "records" | "files" | "channels" | "projects"
  | "mailbox_connections" | "vault_mine" | "private_chats" | "memory_from_you";
export type RemovalAction = "pause" | "reassign" | "revoke" | "export" | "retain" | "keep" | "delete";
export interface OwnedItem { count: number; sample: { type: string; id: string; title: string }[] }

export interface MembersCtx {
  signInMethods?: Readonly<SignInMethods>;
  spaceOwner?(): string | null;
  space: string;
  /** Absent on the pre-auth join calls (caller 'pending'). */
  principal?: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown): unknown;
  /** The host's capability call (ctx.call). */
  call(cap: string, input: unknown): Promise<unknown>;
  /** ctx.http, used only by sso.test (egress is the issuer's domain). */
  http?: (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;
  /** What a person owns across modules, for the removal wizard; supplied by the host from files, records, agents, routines, mailboxes, vault and chat. */
  owned?: {
    of(personId: string): Partial<Record<RemovalKind, OwnedItem>> | Promise<Partial<Record<RemovalKind, OwnedItem>>>;
    /** Items under a legal hold that the person owns. */
    holds(personId: string): number | Promise<number>;
    /** Apply one wizard action to one kind; returns how many things it touched. */
    apply(personId: string, kind: RemovalKind, action: RemovalAction, to?: string): Promise<number>;
  };
  /** Second factors per person, supplied by the host from identity. */
  factors?: { of(personId: string): "totp"[] };
}

export interface InviteRow {
  id: string;
  code_hash: string;
  role: string;
  groups: string;
  agents: string;
  projects: string;
  channels: string;
  email: string | null;
  expires_at: number;
  created_by: string;
  state: "open" | "accepted" | "revoked";
  ai_key_handle: string | null;
  accepted_by: string | null;
  accepted_at: number | null;
  idem_key: string | null;
  created_at: number;
}
export interface InviteView {
  id: string;
  role: string;
  groups: string[];
  agents: string[];
  projects: string[];
  channels: string[];
  email?: string;
  expiresAt: number;
  createdBy: string;
  state: "open" | "accepted" | "revoked" | "expired";
  aiKeyHandle?: string;
  acceptedBy?: string;
  createdAt: number;
}
/** The shape identity's ctx.invites speaks. */
export interface SeamInvite { inviteId: string; role: string; groups: string[]; invitedBy: string }

export const EVERYONE = "grp_everyone";
export const OWNER_ROLE = "rol_owner";
export const DEFAULT_EXPIRY_DAYS = 7;
export const DAY_MS = 24 * 3_600_000;
export const EXPORT_DAYS = 30;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

type Code = Parameters<typeof fail>[0];
export function raise(traceId: string, code: Code, message?: string): never {
  throw fail(code, traceId, message ? { message } : {});
}

/** Random ids from the platform WebCrypto; modules import no crypto themselves (B3). */
export function nid(prefix: string): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}_${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
/** A one-time join code like K7P2-9QXA: 8 characters from a 30 letter alphabet without look-alikes (about 6.5e11 codes). */
export function newCode(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i]! % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export function normCode(code: string): string { return code.trim().toUpperCase().replace(/[\s-]+/g, ""); }
export function hashCode(code: string): string { return sha256b64(`invite:${normCode(code)}`); }

export function me(ctx: MembersCtx): { kind: string; id: string } {
  if (!ctx.principal) raise(ctx.trace.traceId, "auth.unauthenticated");
  return ctx.principal;
}

function list(json: string): string[] {
  try { const v = JSON.parse(json) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

export function invitesAll(ctx: MembersCtx): InviteRow[] {
  return ctx.db.all(`SELECT * FROM members_invites ORDER BY created_at DESC, id DESC`) as InviteRow[];
}
export function inviteById(ctx: MembersCtx, id: string): InviteRow | undefined {
  return ctx.db.all(`SELECT * FROM members_invites WHERE id = ?`, id)[0] as InviteRow | undefined;
}
export function mustInvite(ctx: MembersCtx, id: string): InviteRow {
  const r = inviteById(ctx, id);
  if (!r) raise(ctx.trace.traceId, "validation.not_found", "no such invite");
  return r;
}
export function inviteByCode(ctx: MembersCtx, code: string): InviteRow | undefined {
  return ctx.db.all(`SELECT * FROM members_invites WHERE code_hash = ?`, hashCode(code))[0] as InviteRow | undefined;
}
/** open past its expiry reads as expired; accepted and revoked stay as they are. */
export function stateOf(r: InviteRow, now: number): InviteView["state"] {
  return r.state === "open" && r.expires_at <= now ? "expired" : r.state;
}
export function inviteView(r: InviteRow, now: number): InviteView {
  const v: InviteView = {
    id: r.id, role: r.role, groups: list(r.groups), agents: list(r.agents), projects: list(r.projects), channels: list(r.channels),
    expiresAt: r.expires_at, createdBy: r.created_by, state: stateOf(r, now), createdAt: r.created_at,
  };
  if (r.email) v.email = r.email;
  if (r.ai_key_handle) v.aiKeyHandle = r.ai_key_handle;
  if (r.accepted_by) v.acceptedBy = r.accepted_by;
  return v;
}
export const listOf = list;

export function page<T>(all: readonly T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const lim = Math.min(500, Math.max(1, limit ?? 50));
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const rows = all.slice(start, start + lim);
  const out: { rows: T[]; next?: string; total: number } = { rows, total: all.length };
  if (start + rows.length < all.length) out.next = String(start + rows.length);
  return out;
}

// ---- lifecycle after the join

export interface StatusRow {
  person_id: string; status: "suspended" | "removed"; reason: string | null; by: string; at: number; plan: string | null; export_until: number | null; key_rotation_pending: number;
}
export function statusOf(ctx: MembersCtx, personId: string): StatusRow | undefined {
  return ctx.db.all(`SELECT * FROM members_status WHERE person_id = ?`, personId)[0] as StatusRow | undefined;
}

// ---- policy rows

export function policyGet<T>(ctx: MembersCtx, key: string): T | undefined {
  const r = ctx.db.all(`SELECT value FROM members_policy WHERE key = ?`, key)[0] as { value: string } | undefined;
  return r ? (JSON.parse(r.value) as T) : undefined;
}
export function policyPut(ctx: MembersCtx, key: string, value: unknown): void {
  const by = ctx.principal?.id ?? "system";
  ctx.db.run(`INSERT OR REPLACE INTO members_policy (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, key, JSON.stringify(value), ctx.now(), by);
}
export function policyDrop(ctx: MembersCtx, key: string): number {
  return ctx.db.run(`DELETE FROM members_policy WHERE key = ?`, key).changes;
}
