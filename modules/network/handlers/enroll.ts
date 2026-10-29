// Computers that join the Space for compute (the person's own Mac or PC, or a spare Linux box). Trust runs in three steps and none of them is enough alone: a single-use join code gets a computer
// to the door, the computer's own public key is what the Space will recognise afterwards, and a person approves it once, seeing its name, what it runs on and an 8-character fingerprint that the
// computer prints too. Nothing standing is handed to it: after approval it gets one credential, shown once and kept only as a hash here, and revoking the row ends it.

import { failWith, JOIN_CODE_MS } from "./status.ts";
import type { NetworkCtx } from "./status.ts";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A signed poll is fresh for this long, so a captured one cannot be replayed later. */
const SIGN_WINDOW_MS = 5 * 60_000;

type In = Record<string, unknown>;
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : undefined);
const fromB64 = (text: string): Uint8Array | null => { try { const bin = atob(text); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); } catch { return null; } };
const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes: Uint8Array | string): Promise<string> => hex(await crypto.subtle.digest("SHA-256", typeof bytes === "string" ? new TextEncoder().encode(bytes) : (bytes as Uint8Array<ArrayBuffer>)));

/** The short name a person compares: eight characters from the key's hash, shown as ABCD-EFGH. The computer computes the same from its own key. */
export async function fingerprintOf(publicKey: string): Promise<string> {
  const raw = fromB64(publicKey) ?? new Uint8Array();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw as Uint8Array<ArrayBuffer>));
  const chars = Array.from(digest.slice(0, 8), (b) => FP_ALPHABET[b % FP_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

async function verifyKey(publicKey: string): Promise<CryptoKey | null> {
  const raw = fromB64(publicKey);
  if (!raw || raw.length !== 32) return null;
  try { return await crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, { name: "Ed25519" }, false, ["verify"]); } catch { return null; }
}

function code(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  const ch = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `VYRE-${ch.slice(0, 4)}-${ch.slice(4)}`;
}
const token = (): string => hex(globalThis.crypto.getRandomValues(new Uint8Array(24)).buffer);

/** A join code for a computer of the whole Space (an admin) or for the asker's own computer (any member). Single use, ten minutes, shown once. */
export function makeJoinCode(ctx: NetworkCtx, scope: "space" | "personal"): { code: string; expiresAt: number } {
  const c = code(), expiresAt = ctx.now() + JOIN_CODE_MS;
  ctx.db.run("INSERT INTO network_join (code, by_principal, expires_at, scope) VALUES (?, ?, ?, ?)", c, ctx.actingFor ?? ctx.principal.id, expiresAt, scope);
  return { code: c, expiresAt };
}

const NOT_YOURS = "That code is wrong, already used or expired. Make a new one.";

/** The computer arrives with a code and its public key. It is recorded as waiting, never as admitted. */
export async function enroll(ctx: NetworkCtx, input: In): Promise<{ serverId: string; fingerprint: string; state: "pending" }> {
  const codeText = str(input["code"], 40), publicKey = str(input["publicKey"], 200), name = str(input["name"], 80);
  if (!codeText || !publicKey || !name) return failWith(ctx.trace.traceId, "validation.bad_input", "A join code, a public key and a name are needed.");
  const row = ctx.db.all("SELECT code, by_principal, expires_at, scope, used_at FROM network_join WHERE code = ?", codeText.toUpperCase())[0] as Record<string, unknown> | undefined;
  if (!row || row["used_at"] !== null && row["used_at"] !== undefined || Number(row["expires_at"]) <= ctx.now()) return failWith(ctx.trace.traceId, "auth.invalid_code", NOT_YOURS);
  if (!(await verifyKey(publicKey))) return failWith(ctx.trace.traceId, "validation.bad_input", "The public key is not an Ed25519 key.", { field: "publicKey" });
  // consume the code in one step that only one enroll can win: two at once with the same code cannot both pass the check above across the key verification
  const consumed = ctx.db.run("UPDATE network_join SET used_at = ? WHERE code = ? AND used_at IS NULL AND expires_at > ?", ctx.now(), String(row["code"]), ctx.now()).changes;
  if (consumed !== 1) return failWith(ctx.trace.traceId, "auth.invalid_code", NOT_YOURS);
  const f = (input["facts"] && typeof input["facts"] === "object" ? input["facts"] : {}) as Record<string, unknown>;
  const facts = { os: str(f["os"], 40) ?? "unknown", arch: str(f["arch"], 20) ?? "unknown", docker: f["docker"] === true, version: str(f["version"], 40) ?? "unknown" };
  const fingerprint = await fingerprintOf(publicKey);
  const serverId = `srv_${token().slice(0, 16)}`;
  const personal = row["scope"] === "personal";
  ctx.db.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at, enrollment, public_key, fingerprint, facts_json, owner, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    serverId, name, "compute", "down", null, "pending", publicKey, fingerprint, JSON.stringify(facts), personal ? String(row["by_principal"]) : null, ctx.now());
  ctx.emit("network.server_requested", `server/${serverId}`, { serverId, name, fingerprint });
  return { serverId, fingerprint, state: "pending" };
}

/** The waiting computer asks how it is doing by signing a fresh timestamp with its own key. Approved, it receives its credential once; the Space keeps only the hash. */
export async function enrollStatus(ctx: NetworkCtx, input: In): Promise<{ state: "pending" | "approved" | "declined" | "revoked"; fingerprint: string; credential?: string }> {
  const serverId = str(input["serverId"], 60), signature = str(input["signature"], 200), at = Number(input["at"]);
  const row = serverId ? ctx.db.all("SELECT public_key, fingerprint, enrollment, credential_hash FROM network_server WHERE server_id = ? AND role = 'compute'", serverId)[0] as Record<string, unknown> | undefined : undefined;
  const same = (): never => failWith(ctx.trace.traceId, "auth.invalid_code", NOT_YOURS);
  if (!serverId || !signature || !Number.isFinite(at) || !row || Math.abs(ctx.now() - at) > SIGN_WINDOW_MS) return same();
  const key = await verifyKey(String(row["public_key"]));
  const sig = fromB64(signature);
  if (!key || !sig || !(await crypto.subtle.verify({ name: "Ed25519" }, key, sig as Uint8Array<ArrayBuffer>, new TextEncoder().encode(`vyre-enroll:${serverId}:${at}`)))) return same();
  // each signed request must be later than the last one accepted: a captured request replays as a refusal, so only the key holder, who can sign a fresh one, can ask
  const fresh = ctx.db.run("UPDATE network_server SET last_status_at = ? WHERE server_id = ? AND (last_status_at IS NULL OR last_status_at < ?)", at, serverId, at).changes;
  if (fresh !== 1) return same();
  const state = String(row["enrollment"]) as "pending" | "approved" | "declined" | "revoked";
  const out: { state: typeof state; fingerprint: string; credential?: string } = { state, fingerprint: String(row["fingerprint"]) };
  if (state === "approved") {
    // approved: every fresh signed request gets a credential, and it replaces the last (a reply that was lost heals itself; the old one stops working at once)
    const credential = `vcc_${token()}`;
    ctx.db.run("UPDATE network_server SET credential_hash = ? WHERE server_id = ?", await sha256(credential), serverId);
    out.credential = credential;
  }
  return out;
}

function pending(ctx: NetworkCtx, serverId: string): Record<string, unknown> {
  const row = ctx.db.all("SELECT server_id, name, enrollment, owner FROM network_server WHERE server_id = ? AND role = 'compute'", serverId)[0] as Record<string, unknown> | undefined;
  if (!row) return failWith(ctx.trace.traceId, "validation.not_found", "That computer is not in this Space.", { serverId });
  if (row["enrollment"] !== "pending") return failWith(ctx.trace.traceId, "validation.precondition_failed", "That computer is not waiting for approval.", { serverId });
  return row;
}

/** A person says yes once. The call is held by the Gate for anyone who is not a person. */
export async function approve(ctx: NetworkCtx, input: { serverId: string }): Promise<{ state: "approved" }> {
  const row = pending(ctx, input.serverId);
  ctx.db.run("UPDATE network_server SET enrollment = ?, decided_by = ?, decided_at = ? WHERE server_id = ?", "approved", ctx.actingFor ?? ctx.principal.id, ctx.now(), input.serverId);
  ctx.emit("network.server_added", `server/${input.serverId}`, { serverId: input.serverId, name: String(row["name"]) });
  return { state: "approved" };
}

export async function decline(ctx: NetworkCtx, input: { serverId: string }): Promise<{ state: "declined" }> {
  pending(ctx, input.serverId);
  ctx.db.run("UPDATE network_server SET enrollment = ?, decided_by = ?, decided_at = ? WHERE server_id = ?", "declined", ctx.actingFor ?? ctx.principal.id, ctx.now(), input.serverId);
  return { state: "declined" };
}

/** The owner of a personal computer approves or declines it themselves, and no one else but a Space admin (who has the other capability). */
function mineOrFail(ctx: NetworkCtx, serverId: string): void {
  const row = ctx.db.all("SELECT owner FROM network_server WHERE server_id = ?", serverId)[0] as Record<string, unknown> | undefined;
  const me = ctx.actingFor ?? ctx.principal.id;
  if (!row || row["owner"] !== me) failWith(ctx.trace.traceId, "validation.not_found", "That computer is not yours.", { serverId });
}
export async function approveMine(ctx: NetworkCtx, input: { serverId: string }) { mineOrFail(ctx, input.serverId); return approve(ctx, input); }
export async function declineMine(ctx: NetworkCtx, input: { serverId: string }) { mineOrFail(ctx, input.serverId); return decline(ctx, input); }

/** Take a computer out: its credential stops working at once and the row leaves the list. */
export function revoke(ctx: NetworkCtx, serverId: string): void {
  ctx.db.run("UPDATE network_server SET enrollment = ?, credential_hash = ?, state = ?, decided_by = ?, decided_at = ? WHERE server_id = ?", "revoked", null, "down", ctx.actingFor ?? ctx.principal.id, ctx.now(), serverId);
  ctx.emit("network.server_removed", `server/${serverId}`, { serverId });
}

/** The computer that holds this credential, if it is still admitted (used by the compute channel of the host). */
export async function nodeByCredential(ctx: NetworkCtx, credential: string): Promise<{ serverId: string; owner?: string } | null> {
  const row = ctx.db.all("SELECT server_id, owner FROM network_server WHERE credential_hash = ? AND enrollment = 'approved'", await sha256(credential))[0] as Record<string, unknown> | undefined;
  return row ? { serverId: String(row["server_id"]), ...(row["owner"] ? { owner: String(row["owner"]) } : {}) } : null;
}

/** A computer's regular report: it proves it still holds its credential, the Space notes it is alive and what it runs on, and answers with what it should do (nothing yet: jobs arrive with the compute channel). Host only. */
export async function nodePoll(ctx: NetworkCtx, input: { credential: string; report?: { docker?: boolean; version?: string } }): Promise<{ serverId: string; owner?: string } | null> {
  const who = await nodeByCredential(ctx, String(input.credential ?? ""));
  if (!who) return null;
  const r = input.report ?? {};
  ctx.db.run("UPDATE network_server SET state = ?, heartbeat_at = ? WHERE server_id = ?", "healthy", ctx.now(), who.serverId);
  if (typeof r.docker === "boolean") {
    const row = ctx.db.all("SELECT facts_json FROM network_server WHERE server_id = ?", who.serverId)[0] as Record<string, unknown> | undefined;
    let facts: Record<string, unknown> = {};
    try { facts = JSON.parse(String(row?.["facts_json"] ?? "{}")) as Record<string, unknown>; } catch { facts = {}; }
    if (facts["docker"] !== r.docker) ctx.db.run("UPDATE network_server SET facts_json = ? WHERE server_id = ?", JSON.stringify({ ...facts, docker: r.docker }), who.serverId);
  }
  return who;
}
