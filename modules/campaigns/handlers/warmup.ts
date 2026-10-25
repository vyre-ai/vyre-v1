// campaigns warmup client (spec 2.19; ARCH 7.6, R19; lead ruling Q5): the part of a Space that warms new mailboxes up, in one of two modes.
//   Pool (opted in): the Space joins the opt-in pool service (warmup.vyre.run, relay/warmup) with the mailboxes that are warming, asks it for peers on each pass
//     (POST /v1/pool/join, POST /v1/pool/exchange, both signed by the Space key) and sends its warmup mail to the peers it is given. What the peers saw comes back as health.
//   Seeds (opted out, the default): the pool is never contacted. The Space warms its mailboxes up by sending to its own seed inboxes only.
// A pass is one call to runWarmupPass(ctx) from the host's scheduler. It sends at most the day's ramp for each warming mailbox (warmupCap, the same cap the campaign engine
// enforces), counts what it sent, and reports each mailbox's health to recordWarmupHealth, which slows a mailbox that bounces or lands in spam and announces it once.
// What is counted: a send that mail.send accepts (sent or queued) is a send; one the provider refuses is a refusal and counts toward the bounce rate. A send held for approval
// or suppressed is neither. Spam placement and replies are only ever known from the pool's peers, so in seeds mode they keep their last value.
// The Space key signs; this module never holds it. The host passes a signer (its public key and a sign function) with configureWarmup.
// The wire is documented in relay/warmup/wire.js; the bytes signed are repeated in signedBytes below and pinned by tests on both sides.
// @reads ../migrations/0001_campaigns.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { domainOf, many, num, one, str } from "../projections.ts";
import { poolOptedIn, recordWarmupHealth, sendHandlers, warmupCap } from "./send.ts";

const DAY = 86_400_000;
const WINDOW_DAYS = 7;
const MAX_WANT = 20;
const MAX_PEERS_PER_MAILBOX = 20;
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;

// ---- configuration ------------------------------------------------------------------------------------------

export interface PoolSigner {
  /** the raw 32-byte Ed25519 public key of the Space */
  publicKey: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export interface PoolResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

export type PoolHttp = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<PoolResponse>;

export interface WarmupConfig {
  /** where the pool answers, for example https://warmup.vyre.run */
  poolUrl: string;
  signer: PoolSigner;
  http: PoolHttp;
  /** the Space's own seed inboxes: the only recipients when the Space is not in the pool */
  seeds: string[];
  /** random bytes for a request nonce; tests pass a counter */
  randomBytes?: (n: number) => Uint8Array;
}

let configured: WarmupConfig | null = null;

/** The host calls this once at start with the pool address, the Space key's signer and the seed inboxes. Tests pass fakes; null clears. */
export function configureWarmup(config: WarmupConfig | null): void {
  configured = config;
}

// ---- the signed calls ---------------------------------------------------------------------------------------

export class PoolError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number | undefined;
  constructor(status: number, code: string, message: string, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The bytes the Space key signs: the tag, method, path, time, nonce and the exact body text, one per line. */
export function signedBytes(method: string, path: string, ts: string, nonce: string, body: string): Uint8Array {
  return new TextEncoder().encode(`vyre-warmup-v1\n${method}\n${path}\n${ts}\n${nonce}\n${body}`);
}

export async function signedHeaders(signer: PoolSigner, method: string, path: string, body: string, now: number, nonceBytes: Uint8Array): Promise<Record<string, string>> {
  const ts = String(now);
  const nonce = b64url(nonceBytes);
  const sig = await signer.sign(signedBytes(method, path, ts, nonce, body));
  return { "content-type": "application/json", "x-vyre-key": b64url(signer.publicKey), "x-vyre-ts": ts, "x-vyre-nonce": nonce, "x-vyre-sig": b64url(sig) };
}

async function call(cfg: WarmupConfig, path: string, payload: unknown, now: number): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload);
  const bytes = cfg.randomBytes ? cfg.randomBytes(16) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const headers = await signedHeaders(cfg.signer, "POST", path, body, now, bytes);
  let res: PoolResponse;
  try {
    res = await cfg.http(`${cfg.poolUrl.replace(/\/+$/, "")}${path}`, { method: "POST", headers, body });
  } catch (e) {
    throw new PoolError(0, "provider.network", e instanceof Error ? e.message : "The pool could not be reached.");
  }
  const json = (await res.json().catch(() => ({}))) as { data?: unknown; error?: { code?: unknown; message?: unknown; retryAfterMs?: unknown } };
  if (!res.ok || json.data === undefined || typeof json.data !== "object" || json.data === null) {
    const e = json.error ?? {};
    throw new PoolError(res.status, typeof e.code === "string" ? e.code : "provider.bad_response", typeof e.message === "string" ? e.message : `The pool answered ${res.status}.`, typeof e.retryAfterMs === "number" ? e.retryAfterMs : undefined);
  }
  return json.data as Record<string, unknown>;
}

/** Offers these mailbox addresses to the pool, replacing what was offered; an empty list leaves the pool. */
export async function poolJoin(cfg: WarmupConfig, addresses: string[], now: number): Promise<{ joined: number; left: boolean }> {
  const data = await call(cfg, "/v1/pool/join", { v: 1, mailboxes: addresses.map((address) => ({ address })) }, now);
  return { joined: num(data.joined), left: data.left === true };
}

export interface ExchangeAsk { address: string; want: number }
export interface PoolAssignment { address: string; peers: string[] }
export interface PoolHealth { address: string; reports: number; spamRate: number; replyRate: number; missingRate: number; slow: boolean }

export async function poolExchange(cfg: WarmupConfig, asks: ExchangeAsk[], now: number): Promise<{ assignments: PoolAssignment[]; health: PoolHealth[] }> {
  const data = await call(cfg, "/v1/pool/exchange", { v: 1, mailboxes: asks }, now);
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : []);
  return {
    assignments: list(data.assignments).map((a) => ({ address: str(a.address).toLowerCase(), peers: (Array.isArray(a.peers) ? a.peers : []).filter((p): p is string => typeof p === "string") })),
    health: list(data.health).map((h) => ({ address: str(h.address).toLowerCase(), reports: num(h.reports), spamRate: num(h.spamRate), replyRate: num(h.replyRate), missingRate: num(h.missingRate), slow: h.slow === true })),
  };
}

// ---- state kept in campaigns_setting ------------------------------------------------------------------------

function getSetting(ctx: Ctx, key: string): string {
  return str(one(ctx, "SELECT * FROM campaigns_setting WHERE key = ?", key)?.value);
}

function putSetting(ctx: Ctx, key: string, value: string): void {
  if (one(ctx, "SELECT * FROM campaigns_setting WHERE key = ?", key)) ctx.db.run("UPDATE campaigns_setting SET value = ? WHERE key = ?", value, key);
  else ctx.db.run("INSERT INTO campaigns_setting (key, value) VALUES (?, ?)", key, value);
}

interface DayCount { sent: number; refused: number }

function dayKey(mailboxId: string, day: number): string {
  return `warmup_day:${mailboxId}:${day}`;
}

function readDay(ctx: Ctx, mailboxId: string, day: number): DayCount {
  try {
    const v = JSON.parse(getSetting(ctx, dayKey(mailboxId, day)) || "{}") as Partial<DayCount>;
    return { sent: num(v.sent), refused: num(v.refused) };
  } catch {
    return { sent: 0, refused: 0 };
  }
}

function writeDay(ctx: Ctx, mailboxId: string, day: number, c: DayCount): void {
  putSetting(ctx, dayKey(mailboxId, day), JSON.stringify(c));
}

/** Sends and refusals over the last week, for the bounce rate. */
function weekOf(ctx: Ctx, mailboxId: string, today: number): DayCount {
  const total = { sent: 0, refused: 0 };
  for (let d = today - WINDOW_DAYS + 1; d <= today; d++) {
    const c = readDay(ctx, mailboxId, d);
    total.sent += c.sent;
    total.refused += c.refused;
  }
  return total;
}

function pruneDays(ctx: Ctx, today: number): void {
  for (const r of many(ctx, "SELECT * FROM campaigns_setting")) {
    const m = /^warmup_day:.+:(\d+)$/.exec(str(r.key));
    if (m && Number(m[1]) < today - WINDOW_DAYS) ctx.db.run("DELETE FROM campaigns_setting WHERE key = ?", str(r.key));
  }
}

// ---- the mail ---------------------------------------------------------------------------------------------

const SUBJECTS = [
  "Quick question about next week", "Following up on our call", "Notes from this morning", "Can you check this when you have a minute?",
  "Thanks for the introduction", "Draft for your review", "Re: schedule", "Checking in",
];
const BODIES = [
  "Hi, just checking that this reached you. No rush on a reply, but a short one would help me confirm it landed in the right place.",
  "Thanks for your time earlier. I have written up the points we covered and will send the rest tomorrow. Tell me if I missed anything.",
  "Hello, I am sending the draft over. Take a look when you can and let me know what you would change.",
  "Good morning. A short note to confirm the time we agreed. Reply if anything has changed on your side.",
];

function warmupMessage(seq: number): { subject: string; text: string } {
  return { subject: SUBJECTS[seq % SUBJECTS.length] ?? "Checking in", text: BODIES[(seq * 3 + 1) % BODIES.length] ?? "Hello." };
}

/** One warmup mail. Returns whether it counts as sent; a refusal by the provider is counted; a send held for approval or suppressed is neither. */
async function sendOne(ctx: Ctx, mailboxId: string, to: string, day: number, seq: number): Promise<"sent" | "refused" | "skipped"> {
  const m = warmupMessage(seq + (to.length % 3));
  try {
    const res = (await ctx.call("mail.send", { idempotencyKey: `warmup.${mailboxId}.${day}.${seq}.${to}`, mailboxId, to: [{ address: to }], subject: m.subject, text: m.text })) as { status?: unknown };
    const status = str(res.status);
    return status === "sent" || status === "queued" ? "sent" : "skipped";
  } catch (e) {
    const code = (e as { error?: { code?: unknown } } | null)?.error?.code;
    ctx.log.warn("campaigns: a warmup mail was refused", { mailboxId, code: typeof code === "string" ? code : "" });
    return typeof code === "string" && (code.startsWith("provider.") || code === "validation.precondition_failed") ? "refused" : "skipped";
  }
}

// ---- a pass -------------------------------------------------------------------------------------------------

export interface WarmupPassResult {
  /** off: not configured or nothing to do */
  mode: "pool" | "seeds" | "off";
  mailboxes: number;
  sent: number;
  refused: number;
  slowed: number;
  joined: boolean;
  left: boolean;
  /** why nothing (more) was done, when that is the case */
  skipped: string | null;
}

interface Warming { mailboxId: string; address: string; cap: number; today: DayCount }

export async function runWarmupPass(ctx: Ctx): Promise<WarmupPassResult> {
  const out: WarmupPassResult = { mode: "off", mailboxes: 0, sent: 0, refused: 0, slowed: 0, joined: false, left: false, skipped: null };
  const cfg = configured;
  if (!cfg) { out.skipped = "warmup is not set up on this server"; return out; }
  const now = ctx.now();
  const day = Math.floor(now / DAY);
  const optIn = poolOptedIn(ctx);
  const wasJoined = getSetting(ctx, "warmup_pool_joined") !== "";

  // opting out of a pool the Space joined: leave once, then never contact it again
  if (!optIn && wasJoined) {
    try {
      await poolJoin(cfg, [], now);
      putSetting(ctx, "warmup_pool_joined", "");
      out.left = true;
    } catch (e) {
      ctx.log.warn("campaigns: could not leave the warmup pool; it will be tried again", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const status = (await sendHandlers["warmup.status"](ctx, {})).mailboxes.filter((m) => m.stage !== "ready");
  const warming: Warming[] = [];
  for (const s of status) {
    try {
      const got = (await ctx.call("mail.mailbox.get", { mailboxId: s.mailboxId })) as { mailbox?: { address?: unknown } };
      const address = str(got.mailbox?.address).toLowerCase();
      if (!EMAIL.test(address)) continue;
      const w = one(ctx, "SELECT * FROM campaigns_warmup WHERE mailbox_id = ?", s.mailboxId);
      warming.push({ mailboxId: s.mailboxId, address, cap: w ? warmupCap(w, now) : s.dailyCap, today: readDay(ctx, s.mailboxId, day) });
    } catch (e) {
      ctx.log.warn("campaigns: a warming mailbox could not be read", { mailboxId: s.mailboxId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  out.mailboxes = warming.length;
  if (warming.length === 0) { out.skipped = "no mailbox is warming"; return out; }

  if (optIn) {
    out.mode = "pool";
    await poolMode(ctx, cfg, warming, day, out);
  } else {
    out.mode = "seeds";
    await seedMode(ctx, cfg, warming, day, out);
  }
  pruneDays(ctx, day);
  return out;
}

const remaining = (w: Warming): number => Math.max(0, w.cap - w.today.sent);

async function sendTo(ctx: Ctx, w: Warming, peers: string[], day: number, out: WarmupPassResult): Promise<void> {
  for (const peer of peers) {
    if (remaining(w) <= 0) break;
    const r = await sendOne(ctx, w.mailboxId, peer, day, w.today.sent + w.today.refused);
    if (r === "sent") { w.today.sent += 1; out.sent += 1; }
    else if (r === "refused") { w.today.refused += 1; out.refused += 1; }
    writeDay(ctx, w.mailboxId, day, w.today);
  }
}

async function poolMode(ctx: Ctx, cfg: WarmupConfig, warming: Warming[], day: number, out: WarmupPassResult): Promise<void> {
  const now = ctx.now();
  const addresses = warming.map((w) => w.address).sort();
  const hash = addresses.join(",");
  try {
    if (getSetting(ctx, "warmup_pool_joined") !== hash) {
      await poolJoin(cfg, addresses, now);
      putSetting(ctx, "warmup_pool_joined", hash);
      out.joined = true;
    }
    const own = new Set(addresses);
    const ownDomains = new Set(addresses.map(domainOf));
    const answer = await poolExchange(cfg, warming.map((w) => ({ address: w.address, want: Math.min(MAX_WANT, remaining(w)) })), now);
    for (const w of warming) {
      const mine = answer.assignments.find((a) => a.address === w.address);
      // peers are other Spaces' mailboxes: anything that is one of ours, or on a domain of ours, or not an address, is ignored
      const peers = [...new Set((mine?.peers ?? []).map((p) => p.trim().toLowerCase()))].filter((p) => EMAIL.test(p) && !own.has(p) && !ownDomains.has(domainOf(p))).slice(0, MAX_PEERS_PER_MAILBOX);
      await sendTo(ctx, w, peers, day, out);
      const health = answer.health.find((h) => h.address === w.address);
      const week = weekOf(ctx, w.mailboxId, day);
      const refusedRate = week.sent + week.refused === 0 ? 0 : week.refused / (week.sent + week.refused);
      if (health && (health.reports > 0 || week.sent + week.refused > 0)) {
        const r = recordWarmupHealth(ctx, w.mailboxId, { bounceRate: Math.max(refusedRate, health.missingRate), replyRate: health.replyRate, spamRate: health.spamRate });
        if (r === "slowed") out.slowed += 1;
      }
    }
  } catch (e) {
    if (e instanceof PoolError) {
      if (e.code === "auth.not_joined") putSetting(ctx, "warmup_pool_joined", "");
      out.skipped = e.status === 429 ? "the pool asked to wait" : `the pool said no: ${e.code}`;
    } else {
      out.skipped = "the pool could not be used";
    }
    ctx.log.warn("campaigns: a warmup pass could not use the pool", { error: e instanceof Error ? e.message : String(e) });
  }
}

async function seedMode(ctx: Ctx, cfg: WarmupConfig, warming: Warming[], day: number, out: WarmupPassResult): Promise<void> {
  const seeds = [...new Set(cfg.seeds.map((s) => s.trim().toLowerCase()).filter((s) => EMAIL.test(s)))];
  let cursor = Number(getSetting(ctx, "warmup_seed_cursor") || "0");
  if (!Number.isInteger(cursor) || cursor < 0) cursor = 0;
  for (const w of warming) {
    const candidates = seeds.filter((s) => s !== w.address);
    if (candidates.length === 0) { out.skipped = "this Space has no seed inbox to warm up with"; continue; }
    const peers: string[] = [];
    for (let i = 0; i < remaining(w); i++) peers.push(candidates[(cursor + i) % candidates.length] as string);
    cursor += peers.length;
    await sendTo(ctx, w, peers, day, out);
    const week = weekOf(ctx, w.mailboxId, day);
    if (week.sent + week.refused > 0) {
      // spam placement and replies cannot be seen from here, so they keep the value they had
      const kept = one(ctx, "SELECT * FROM campaigns_warmup WHERE mailbox_id = ?", w.mailboxId);
      const r = recordWarmupHealth(ctx, w.mailboxId, { bounceRate: week.refused / (week.sent + week.refused), replyRate: num(kept?.reply_bp) / 10000, spamRate: num(kept?.spam_bp) / 10000 });
      if (r === "slowed") out.slowed += 1;
    }
  }
  putSetting(ctx, "warmup_seed_cursor", String(cursor % 1_000_000));
}
