// A CLI sign-in the engine refreshed during a turn, read back and saved to the Vault item it came from (owner, rc.13: "You should never lose credentials if they're in here"). Codex and Grok sign in with
// files the engine puts in its home for the turn; when the CLI refreshes its token it rewrites them, and the refresh token the Vault held is then used up. The files are read back when the CLI ends and,
// when they are still a sign-in of the same account and newer than what the Vault holds, saved over it.
//
//   readSignin    what a file map is: a sign-in (the account it names, how fresh it is) or not (signed out, unreadable). Never a value out.
//   decideRefresh whether a read-back map replaces what the Vault holds now. The newest wins by the sign-in's own clock (the access token's expiry, else `last_refresh`), never by the order saves arrive in.
//   createSigninRefresh  the host's one narrow save: the files wait here under a single-use ticket while the Vault module's host call (vault.signin_refreshed) takes them. The values never travel
//                 through the invoke pipeline, an event, a log line or the model; only the ticket, the item id and the person do.
// UNVERIFIED against live accounts: Codex's auth.json is read as `codex login` writes it (tokens.access_token, tokens.refresh_token, tokens.id_token, last_refresh); Grok's files are read for any token,
// expiry and refresh time they carry, since its layout is not documented. A layout that changes reads as "not a sign-in" and nothing is saved: the Vault keeps what it had.
import { randomHex } from "../../../kernel/src/log/hash.ts";
import { codexIdentity, grokIdentity, jwtClaims } from "./signin-identity.ts";

/** The read-back files: path (relative to the engine's home) to text, null for a file that is gone. */
export type ReadBack = Readonly<Record<string, string | null>>;

/** How fresh a sign-in is, in ms: the access token's expiry and when it was last refreshed. Either may be unknown. */
export interface Freshness { exp?: number; at?: number }

export type SigninRead =
  | { ok: true; /** The account it names (compared, never shown); null when it names nobody. */ identity: string | null; fresh: Freshness }
  | { ok: false; why: "signed_out" | "unreadable" };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const parse = (text: string): unknown => { try { return JSON.parse(text) as unknown; } catch { return undefined; } };
/** A time as ms: a number in seconds or ms, or an ISO date. */
function ms(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v.trim() !== "") { const t = Date.parse(v); if (Number.isFinite(t)) return t; if (/^\d+$/.test(v.trim())) return ms(Number(v)); }
  return undefined;
}
const later = (a: number | undefined, b: number | undefined): number | undefined => (a === undefined ? b : b === undefined ? a : Math.max(a, b));
const expOf = (token: string): number | undefined => { const c = token.split(".").length === 3 ? jwtClaims(token) : null; return c ? ms(c["exp"]) : undefined; };

/** Which CLI a file map belongs to when the caller does not know: Codex keeps `.codex/auth.json`; anything else is read the generic way (Grok). */
export function providerOfFiles(files: Readonly<Record<string, unknown>>): "codex" | "grok" {
  return Object.keys(files).some((k) => k === ".codex/auth.json" || k.endsWith("/.codex/auth.json")) ? "codex" : "grok";
}

function readCodex(files: Readonly<Record<string, string>>): SigninRead {
  const key = Object.keys(files).find((k) => k === ".codex/auth.json") ?? Object.keys(files).find((k) => k.endsWith("auth.json"));
  if (key === undefined) return { ok: false, why: "unreadable" };
  const j = rec(parse(files[key] ?? ""));
  if (!j) return { ok: false, why: "unreadable" };
  const tokens = rec(j["tokens"]);
  const access = str(tokens?.["access_token"]), refresh = str(tokens?.["refresh_token"]);
  // `codex logout` removes the file; an API-key file (OPENAI_API_KEY and no tokens) or one with the tokens cleared is not a subscription sign-in
  if (access === "" || refresh === "") return { ok: false, why: "signed_out" };
  const exp = expOf(access), at = ms(j["last_refresh"]);
  return { ok: true, identity: codexIdentity(str(tokens?.["id_token"]))?.id ?? null, fresh: { ...(exp !== undefined ? { exp } : {}), ...(at !== undefined ? { at } : {}) } };
}

const TOKEN_KEY = /token|secret|session|credential|cookie|key/i;
const EXP_KEY = /^(exp|expiry|expires|expires_?at|expires_?on|expiration|expiration_?time)$/i;
const AT_KEY = /^(last_?refresh|refreshed_?at|last_?refreshed|issued_?at|iat|updated_?at|created_?at)$/i;

function readGeneric(files: Readonly<Record<string, string>>): SigninRead {
  let tokenish = false, exp: number | undefined, at: number | undefined;
  const visit = (v: unknown, key: string, depth: number): void => {
    if (depth > 8) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s.split(".").length === 3 && jwtClaims(s)) { tokenish = true; exp = later(exp, expOf(s)); return; }
      const inner = s.startsWith("{") || s.startsWith("[") ? parse(s) : undefined;
      if (inner !== undefined && inner !== null && typeof inner === "object") { visit(inner, key, depth + 1); return; }
      if (TOKEN_KEY.test(key) && s.length >= 16 && !/\s/.test(s)) tokenish = true;
      if (EXP_KEY.test(key)) exp = later(exp, ms(s));
      else if (AT_KEY.test(key)) at = later(at, ms(s));
      return;
    }
    if (typeof v === "number") { if (EXP_KEY.test(key)) exp = later(exp, ms(v)); else if (AT_KEY.test(key)) at = later(at, ms(v)); return; }
    if (Array.isArray(v)) { for (const x of v) visit(x, key, depth + 1); return; }
    const r = rec(v);
    if (r) for (const [k, x] of Object.entries(r)) visit(x, k, depth + 1);
  };
  for (const [rel, text] of Object.entries(files)) {
    if (text.trim() === "") return { ok: false, why: "signed_out" };
    const j = parse(text);
    // a file that is not JSON may be a bare token
    if (j === undefined) { if (text.trim().length >= 16 && !/\s/.test(text.trim())) tokenish = true; continue; }
    visit(j, rel, 0);
  }
  if (!tokenish) return { ok: false, why: "signed_out" };
  return { ok: true, identity: grokIdentity(files)?.id ?? null, fresh: { ...(exp !== undefined ? { exp } : {}), ...(at !== undefined ? { at } : {}) } };
}

/** What a file map is. A map with a file that is gone, or empty, is a sign-out. */
export function readSignin(provider: string | null, files: ReadBack): SigninRead {
  const entries = Object.entries(files);
  if (entries.length === 0) return { ok: false, why: "unreadable" };
  if (entries.some(([, t]) => t === null)) return { ok: false, why: "signed_out" };
  const texts = files as Readonly<Record<string, string>>;
  return (provider ?? providerOfFiles(files)) === "codex" ? readCodex(texts) : readGeneric(texts);
}

/** Above 0 when `a` is the newer sign-in, below 0 when it is older, 0 when the two cannot be told apart. The expiry decides first, the refresh time next. */
export function compareFresh(a: Freshness, b: Freshness): number {
  if (a.exp !== undefined && b.exp !== undefined && a.exp !== b.exp) return a.exp > b.exp ? 1 : -1;
  if (a.at !== undefined && b.at !== undefined && a.at !== b.at) return a.at > b.at ? 1 : -1;
  return 0;
}

const same = (a: ReadBack, b: ReadBack): boolean => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
};

export type RefreshDecision =
  | { save: true }
  | { save: false; why: "unchanged" | "signed_out" | "unreadable" | "other_account" | "older" };

/**
 * Whether the read-back files replace what the Vault holds now. `filled`: what the Vault gave the turn when it started; `current`: what the Vault holds now (another turn may have saved since);
 * `known`: the account the provider row was signed in to, when one was recorded.
 *   - a sign-out (a file gone, the tokens cleared) or files that are not a sign-in are never saved;
 *   - another account (not the one the turn started with, nor the one the row records) is never saved;
 *   - newer by the sign-in's own clock wins; when the two cannot be told apart, the files win only if nobody saved since the turn began.
 */
export function decideRefresh(p: { provider: string; filled: ReadBack; current: ReadBack; back: ReadBack; known?: string | null }): RefreshDecision {
  if (same(p.back, p.current)) return { save: false, why: "unchanged" };
  const back = readSignin(p.provider, p.back);
  if (!back.ok) return { save: false, why: back.why };
  const filled = readSignin(p.provider, p.filled), current = readSignin(p.provider, p.current);
  const started = filled.ok ? filled : current;
  if (started.ok && started.identity !== back.identity) return { save: false, why: "other_account" };
  if (current.ok && current.identity !== back.identity) return { save: false, why: "other_account" };
  if (p.known && p.known !== back.identity) return { save: false, why: "other_account" };
  const cmp = current.ok ? compareFresh(back.fresh, current.fresh) : 1;
  if (cmp > 0) return { save: true };
  if (cmp < 0) return { save: false, why: "older" };
  return same(p.current, p.filled) ? { save: true } : { save: false, why: "older" };
}

/** What the engine hands the host when a CLI ends with sign-in files that differ from what the Vault filled. */
export interface RefreshedSignin { itemId: string; asker: string; /** The Vault's value the turn started with: the JSON file map. */ filled: string; files: ReadBack }

export interface SigninRefresh {
  /** Save the read-back files to their item through the Vault module's host call. Never throws; a refusal or a failure is logged with the item id and a reason, never a value. */
  save(r: RefreshedSignin): Promise<{ saved: boolean; reason: string }>;
  /** The Vault module's side: the files under a ticket, once, for the item they were saved for. */
  take(ticket: string, itemId: string): { asker: string; filled: string; files: ReadBack } | null;
}

/** The code of a failed call (a HostError carries the shaped error), never its message. */
const codeOf = (e: unknown): string => {
  const x = e as { error?: { code?: unknown }; code?: unknown } | null;
  const c = x?.error?.code ?? x?.code;
  return typeof c === "string" ? c : "failed";
};

export function createSigninRefresh(d: { call(name: string, input: unknown): Promise<unknown>; log?(msg: string, attrs?: Record<string, unknown>): void }): SigninRefresh {
  const held = new Map<string, RefreshedSignin>();
  return {
    async save(r) {
      const ticket = randomHex(24);
      held.set(ticket, r);
      let out: { saved: boolean; reason: string };
      try {
        const got = rec(await d.call("vault.signin_refreshed", { ticket, itemId: r.itemId, asker: r.asker }));
        out = { saved: got?.["saved"] === true, reason: str(got?.["reason"]) || "unknown" };
      } catch (e) { out = { saved: false, reason: codeOf(e) }; }
      finally { held.delete(ticket); }
      d.log?.(out.saved ? "a CLI refreshed its sign-in and the Vault kept it" : "a CLI's sign-in files were not saved back", { itemId: r.itemId, reason: out.reason });
      return out;
    },
    take(ticket, itemId) {
      const h = held.get(ticket);
      if (!h || h.itemId !== itemId) return null;
      held.delete(ticket);
      return { asker: h.asker, filled: h.filled, files: h.files };
    },
  };
}
