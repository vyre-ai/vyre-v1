// The daily quota of memory learning (owner ruling 3 Nov 2026): per person, 150 model passes and 400k input tokens a day by default, whichever comes first, reset at the person's local
// midnight (their profile.timezone). Owners and admins change the defaults (Console > AI > Memory learning, settings memory.learn_daily_passes and memory.learn_daily_tokens).
// The quota is never crossed: a pass reserves its tokens before it starts, in one synchronous step, and starts only when the reservation fits in what is left of the day. The reservation is
// the larger of the pass's own estimate and the largest pass that account has run, plus a quarter, so a provider that counts more than we guessed still lands under the line.
// At the quota, learning falls back to the free rules until the reset; nothing is shown as an error.
// Also here: the per-account pause after a rate or usage limit, with a backoff, and the cache of the model each account learns with.
import { setting } from "./policy.ts";
import { num, rowsOf, str } from "./projections.ts";
import type { MemCtx } from "./projections.ts";

export const LEARN_PASSES_DEFAULT = 150;
export const LEARN_TOKENS_DEFAULT = 400_000;
/**
 * What a CLI engine adds to a learning pass of its own, before we have seen one of its passes. The pass runs the engine's leanest command (claudeLean, codexLean): measured against Claude Code
 * 2.1.316 and codex-cli 0.166 with a recording endpoint, about 400 and 480 tokens besides our prompt (it was 12,000 and more with the engines' own prompts and tools). An API call adds next to nothing.
 */
export const CLI_OVERHEAD_GUESS = 600;
export const API_OVERHEAD_GUESS = 300;
const CLI_DRIVERS: ReadonlySet<string> = new Set(["claude_code", "codex", "grok"]);
/** A pass's prompt is about one token for every 3.5 characters; we guess low characters per token so the estimate errs high. */
const CHARS_PER_TOKEN = 3;
export const MODEL_TTL_MS = 12 * 3_600_000;
const BACKOFF_FIRST_MS = 60_000;
const BACKOFF_MAX_MS = 6 * 3_600_000;
/** A failure that is not a limit (a model the account no longer has, a network fault) pauses the account briefly and forgets its model, so the next pass picks again. */
const OTHER_FAILURE_PAUSE_MS = 15 * 60_000;

const TABLES = [
  "CREATE TABLE IF NOT EXISTS memory_learn_usage (person TEXT NOT NULL, day TEXT NOT NULL, passes INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, rule_passes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (person, day))",
  "CREATE TABLE IF NOT EXISTS memory_learn_accounts (account_ref TEXT PRIMARY KEY, overhead INTEGER, biggest INTEGER NOT NULL DEFAULT 0, strikes INTEGER NOT NULL DEFAULT 0, paused_until INTEGER NOT NULL DEFAULT 0, model TEXT, model_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS memory_learn_cursor (thread_id TEXT NOT NULL, person TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (thread_id, person))",
  "CREATE TABLE IF NOT EXISTS memory_chat_learning (thread_id TEXT PRIMARY KEY, off INTEGER NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL)",
];
const ready = new WeakSet<object>();
export function learnTables(db: MemCtx["db"]): void {
  if (ready.has(db)) return;
  for (const sql of TABLES) db.run(sql);
  ready.add(db);
}

// ---- the person's day

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function partsAt(at: number, tz: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(at))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p["year"]!, m: p["month"]!, d: p["day"]!, h: p["hour"]! % 24, min: p["minute"]!, s: p["second"]! };
}
const validZone = (tz: string): string => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; } };
/** How far the zone is ahead of UTC at this moment, in ms. */
const offsetAt = (at: number, tz: string): number => { const p = partsAt(at, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - (at - (at % 1000)); };

/** The person's calendar day ("2026-11-03") at `at`, and when it ends (their next local midnight). */
export function localDay(at: number, tz: string): { day: string; resetsAt: number } {
  const zone = validZone(tz);
  const p = partsAt(at, zone);
  const day = `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  const guess = Date.UTC(p.y, p.m - 1, p.d + 1) - offsetAt(at, zone);
  return { day, resetsAt: Date.UTC(p.y, p.m - 1, p.d + 1) - offsetAt(guess, zone) };
}

export async function timezoneOf(ctx: Pick<MemCtx, "call">): Promise<string> {
  return setting(ctx, "profile.timezone", "UTC", isStr);
}

export interface Caps { passes: number; tokens: number }
export async function capsOf(ctx: Pick<MemCtx, "call">): Promise<Caps> {
  const passes = await setting(ctx, "memory.learn_daily_passes", LEARN_PASSES_DEFAULT, isCount);
  const tokens = await setting(ctx, "memory.learn_daily_tokens", LEARN_TOKENS_DEFAULT, isCount);
  return { passes: Math.floor(passes), tokens: Math.floor(tokens) };
}

export interface DayUse { passes: number; tokensIn: number; tokensOut: number; reserved: number; rulePasses: number }
export function usageOf(ctx: Pick<MemCtx, "db">, person: string, day: string): DayUse {
  learnTables(ctx.db);
  const r = rowsOf(ctx.db, "SELECT passes, tokens_in, tokens_out, reserved, rule_passes FROM memory_learn_usage WHERE person = ? AND day = ?", person, day)[0];
  return { passes: num(r?.["passes"]), tokensIn: num(r?.["tokens_in"]), tokensOut: num(r?.["tokens_out"]), reserved: num(r?.["reserved"]), rulePasses: num(r?.["rule_passes"]) };
}

// ---- reservation: one synchronous step, so two turns that end together cannot both take the last of the day

export interface Account { overhead: number | null; biggest: number; strikes: number; pausedUntil: number; model: string | null; modelAt: number }
export function accountOf(ctx: Pick<MemCtx, "db">, ref: string): Account {
  learnTables(ctx.db);
  const r = rowsOf(ctx.db, "SELECT * FROM memory_learn_accounts WHERE account_ref = ?", ref)[0];
  return {
    overhead: r?.["overhead"] === null || r?.["overhead"] === undefined ? null : num(r["overhead"]), biggest: num(r?.["biggest"]), strikes: num(r?.["strikes"]), pausedUntil: num(r?.["paused_until"]),
    model: r?.["model"] ? str(r["model"]) : null, modelAt: num(r?.["model_at"]),
  };
}
const putAccount = (ctx: Pick<MemCtx, "db">, ref: string, a: Account): void => {
  ctx.db.run(
    "INSERT INTO memory_learn_accounts (account_ref, overhead, biggest, strikes, paused_until, model, model_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_ref) DO UPDATE SET overhead = excluded.overhead, biggest = excluded.biggest, strikes = excluded.strikes, paused_until = excluded.paused_until, model = excluded.model, model_at = excluded.model_at",
    ref, a.overhead, a.biggest, a.strikes, a.pausedUntil, a.model, a.modelAt,
  );
};

/** The tokens a pass of `chars` characters is set aside for on this account. */
export function reservationFor(ctx: Pick<MemCtx, "db">, ref: string, driver: string, chars: number): number {
  const a = accountOf(ctx, ref);
  const overhead = a.overhead ?? (CLI_DRIVERS.has(driver) ? CLI_OVERHEAD_GUESS : API_OVERHEAD_GUESS);
  const estimate = Math.ceil(chars / CHARS_PER_TOKEN) + overhead;
  return Math.ceil(Math.max(estimate, a.biggest) * 1.25);
}

export type Refusal = "passes" | "tokens";
/** Take one pass and `tokens` of the day for the person, or say which limit stops it. */
export function reserve(ctx: Pick<MemCtx, "db">, person: string, day: string, caps: Caps, tokens: number): Refusal | null {
  const u = usageOf(ctx, person, day);
  if (u.passes >= caps.passes) return "passes";
  if (u.tokensIn + u.reserved + tokens > caps.tokens) return "tokens";
  ctx.db.run(
    "INSERT INTO memory_learn_usage (person, day, passes, reserved) VALUES (?, ?, 1, ?) ON CONFLICT(person, day) DO UPDATE SET passes = passes + 1, reserved = reserved + excluded.reserved",
    person, day, tokens,
  );
  return null;
}

/** The pass ran: its real tokens replace what was set aside. A pass that never reached the model (a limit, a fault) gives its pass and tokens back. */
export function settle(ctx: Pick<MemCtx, "db">, person: string, day: string, reserved: number, used: { tokensIn: number; tokensOut: number } | null): void {
  if (used) ctx.db.run("UPDATE memory_learn_usage SET reserved = MAX(0, reserved - ?), tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE person = ? AND day = ?", reserved, used.tokensIn, used.tokensOut, person, day);
  else ctx.db.run("UPDATE memory_learn_usage SET reserved = MAX(0, reserved - ?), passes = MAX(0, passes - 1) WHERE person = ? AND day = ?", reserved, person, day);
}

export function countRulePass(ctx: Pick<MemCtx, "db">, person: string, day: string): void {
  learnTables(ctx.db);
  ctx.db.run("INSERT INTO memory_learn_usage (person, day, rule_passes) VALUES (?, ?, 1) ON CONFLICT(person, day) DO UPDATE SET rule_passes = rule_passes + 1", person, day);
}

// ---- what the account taught us, and its pause

/** A pass finished: learn what this account adds to every request, and that it is healthy again. */
export function accountServed(ctx: Pick<MemCtx, "db">, ref: string, chars: number, tokensIn: number): void {
  const a = accountOf(ctx, ref);
  const seen = Math.max(0, tokensIn - Math.ceil(chars / 3.5));
  putAccount(ctx, ref, { ...a, overhead: a.overhead === null ? seen : Math.round((a.overhead + seen) / 2), biggest: Math.max(a.biggest, tokensIn), strikes: 0, pausedUntil: 0 });
}

/** A provider said slow down (a rate or usage limit): pause learning on that account, one minute doubling to six hours. Anything else pauses it briefly and forgets its model. */
export function accountFailed(ctx: Pick<MemCtx, "db">, ref: string, now: number, limit: boolean): number {
  const a = accountOf(ctx, ref);
  if (!limit) {
    putAccount(ctx, ref, { ...a, pausedUntil: now + OTHER_FAILURE_PAUSE_MS, model: null, modelAt: 0 });
    return now + OTHER_FAILURE_PAUSE_MS;
  }
  const until = now + Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** a.strikes);
  putAccount(ctx, ref, { ...a, strikes: a.strikes + 1, pausedUntil: until });
  return until;
}

export function rememberModel(ctx: Pick<MemCtx, "db">, ref: string, model: string, now: number): void {
  putAccount(ctx, ref, { ...accountOf(ctx, ref), model, modelAt: now });
}

const LIMIT_WORDS = /rate.?limit|\b429\b|too many requests|usage.?limit|quota|overloaded|capacity|resource.?exhausted|limit (?:reached|exceeded)|out of (?:credits|usage)|insufficient.?(?:credit|balance)/i;
/** A provider's rate-limit or usage-limit error, by its code or words. */
export function isLimitError(e: unknown): boolean {
  const code = (e as { code?: unknown; error?: { code?: unknown } } | null)?.code ?? (e as { error?: { code?: unknown } } | null)?.error?.code;
  const msg = e instanceof Error ? e.message : (e as { error?: { message?: unknown } } | null)?.error?.message;
  return [code, msg].some((x) => typeof x === "string" && LIMIT_WORDS.test(x));
}

// ---- the cursor: what of a chat a person's passes have read

export function cursorOf(ctx: Pick<MemCtx, "db">, threadId: string, person: string): number {
  learnTables(ctx.db);
  const r = rowsOf(ctx.db, "SELECT seq FROM memory_learn_cursor WHERE thread_id = ? AND person = ?", threadId, person)[0];
  return r ? num(r["seq"]) : -1;
}
export function moveCursor(ctx: Pick<MemCtx, "db" | "now">, threadId: string, person: string, seq: number): void {
  ctx.db.run("INSERT INTO memory_learn_cursor (thread_id, person, seq, at) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id, person) DO UPDATE SET seq = MAX(seq, excluded.seq), at = excluded.at", threadId, person, seq, ctx.now());
}

// ---- "Don't remember this chat"

export function chatForgotten(ctx: Pick<MemCtx, "db">, threadId: string): { off: boolean; by?: string; at?: number } {
  learnTables(ctx.db);
  const r = rowsOf(ctx.db, "SELECT off, by, at FROM memory_chat_learning WHERE thread_id = ?", threadId)[0];
  return r && num(r["off"]) === 1 ? { off: true, by: str(r["by"]), at: num(r["at"]) } : { off: false };
}
