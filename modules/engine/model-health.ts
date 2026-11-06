// Which models an account serves (owner ruling, 4 Nov 2026: a model that is not available is not shown). Three things are kept per account and model:
//  - bad: a turn or a probe found the engine refusing it. The picker leaves it out; the mark ends after REST_MS, so it is tried again later and comes back by itself when it works.
//  - ok: a probe or a turn confirmed it. Confirmed for CONFIRM_MS, then checked again.
//  - neither: not checked yet. For an API key the picker shows it greyed ("Checking...") while a background probe (one tiny request, capped) runs.
// A sign-in change (a key added, removed or changed, a re-auth) forgets everything for the accounts, so they are checked again.
import { modelGone } from "../../agent/src/drivers/cli/errors.ts";
import type { Db } from "./projections.ts";

/** How long a model stays off an account's list after it failed. */
export const REST_MS = 2 * 3600_000;
/** How long a confirmed model stays confirmed. */
export const CONFIRM_MS = 24 * 3600_000;
/** At most this many models of one account are probed in one run (a provider with hundreds of models is not probed one by one; the rest are shown as listed and checked by their first turn). */
export const PROBE_CAP = 12;
/** Probes of one account run this many at a time. */
export const PROBE_PARALLEL = 2;
/** A CLI engine is probed one model at a time, each with this long to answer (a process per model is heavy). A timeout says nothing about the model. */
export const CLI_PROBE_PARALLEL = 1;
export const CLI_PROBE_TIMEOUT_MS = 10_000;
/** An API key's check gets this long; a check that takes longer is "Not checked", and the model stays selectable. */
export const API_PROBE_TIMEOUT_MS = 10_000;
/** How long "Not checked" is remembered before the account is checked again. */
export const NOT_CHECKED_MS = 60_000;
export const PROBE_PROMPT = "Reply with the single word: ok";

const ready = new WeakSet<object>();

function ensure(db: Db): void {
  if (ready.has(db as object)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_model_health (account_ref TEXT NOT NULL, model TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (account_ref, model))");
  db.run("CREATE TABLE IF NOT EXISTS engine_model_account (provider_id TEXT PRIMARY KEY, account_ref TEXT NOT NULL)");
  ready.add(db as object);
}
const put = (db: Db, ref: string, model: string, state: "bad" | "ok", now: number): void => {
  ensure(db);
  db.run("INSERT OR REPLACE INTO engine_model_health (account_ref, model, state, at) VALUES (?, ?, ?, ?)", ref, model, state, now);
};

/** The account did not serve the model just now. */
export const markUnavailable = (db: Db, ref: string, model: string, now: number): void => put(db, ref, model, "bad", now);
/** The account served the model (a probe answered, or a turn ran on it). */
export const markConfirmed = (db: Db, ref: string, model: string, now: number): void => put(db, ref, model, "ok", now);

const modelsIn = (db: Db, ref: string, state: "bad" | "ok", since: number): Set<string> => {
  ensure(db);
  return new Set((db.all("SELECT model FROM engine_model_health WHERE account_ref = ? AND state = ? AND at > ?", ref, state, since) as Array<{ model: string }>).map((r) => r.model));
};
/** The models this account is known not to serve right now. */
export const unavailableFor = (db: Db, ref: string, now: number): Set<string> => modelsIn(db, ref, "bad", now - REST_MS);
/** The models this account is known to serve. */
export const confirmedFor = (db: Db, ref: string, now: number): Set<string> => modelsIn(db, ref, "ok", now - CONFIRM_MS);

/** Forget what is known about one account's model (or all of its models). */
export function clearUnavailable(db: Db, ref: string, model?: string): void {
  ensure(db);
  if (model === undefined) db.run("DELETE FROM engine_model_health WHERE account_ref = ?", ref);
  else db.run("DELETE FROM engine_model_health WHERE account_ref = ? AND model = ?", ref, model);
}
/** A sign-in changed: every account is checked again at the next read. */
export function forgetAll(db: Db): void {
  ensure(db);
  db.run("DELETE FROM engine_model_health");
}

/** Which account a provider row (the id its events carry) is, so a sign-in change forgets that account only. */
export function noteAccount(db: Db, providerId: string, ref: string): void {
  ensure(db);
  db.run("INSERT OR REPLACE INTO engine_model_account (provider_id, account_ref) VALUES (?, ?)", providerId, ref);
}
/** A sign-in of this provider changed (connected, removed, re-authorized, key changed): what was learned about its account is forgotten. Answers the account, or null when none was known. */
export function forgetProvider(db: Db, providerId: string): string | null {
  ensure(db);
  const r = db.all("SELECT account_ref FROM engine_model_account WHERE provider_id = ?", providerId)[0] as { account_ref: string } | undefined;
  if (!r) return null;
  clearUnavailable(db, r.account_ref);
  return r.account_ref;
}

/** An API provider's own words for a model it does not serve (a 404, "model_not_found", "does not exist"). Anything else says nothing about the model. */
const REFUSED = /model[_ ]not[_ ]found|no such model|unknown model|invalid model|model .{0,60}(?:does not exist|not found|not available|is not supported|not supported)|\b404\b|do(?:es)? not have access to (?:the )?model/i;
export const refusesModel = (message: string): boolean => modelGone(message) || /engine\.model_unavailable/.test(message) || REFUSED.test(message);

/** Asks one account for one tiny answer on one model. A rejection is the provider's refusal. */
export type Ask = (ref: string, model: string) => Promise<void>;
const running = new Map<string, Promise<void>>();
const key = (ref: string, model: string): string => `${ref}\u0000${model}`;

const unchecked = new Map<string, number>();
const star = "*";
/** A check ended without an answer for a reason that says nothing about the model (the Vault key is not on this node, or it took too long): it is "Not checked", not "Checking", for a while. `model` null: the whole account. */
export const markNotChecked = (ref: string, model: string | null, now: number): void => { unchecked.set(key(ref, model ?? star), now); };
/** What is not checked for this account right now: all of it, or these models. */
export function notCheckedFor(ref: string, now: number): { account: boolean; models: Set<string> } {
  const out = { account: false, models: new Set<string>() };
  for (const [k, at] of unchecked) {
    if (now - at > NOT_CHECKED_MS) { unchecked.delete(k); continue; }
    const [r, m] = k.split("\u0000");
    if (r !== ref) continue;
    if (m === star) out.account = true; else out.models.add(m!);
  }
  return out;
}
/** A probe failed because the person's Vault key is not on this node. */
export const keyMissing = (text: string): boolean => /engine\.vault_locked|vault key is (?:locked|not on)|sign-ins are locked|Vault is not live/i.test(text);

/** Probes in flight for these accounts, so a read can wait for them. */
export const probing = (refs: readonly string[]): Promise<void>[] => [...running.entries()].filter(([k]) => refs.some((r) => k.startsWith(`${r}\u0000`))).map(([, p]) => p);
export const probeRunning = (ref: string): boolean => [...running.keys()].some((k) => k.startsWith(`${ref}\u0000`));
/** Tests: forget probes in flight. */
export function resetProbes(): void { running.clear(); unchecked.clear(); }

/**
 * Check these models in the background, two at a time: an answer confirms the model, the provider refusing it marks it bad, and anything else (a rate limit, no network, a failed sign-in) says nothing
 * about the model, so it stays shown. Never throws, never waits for the caller.
 */
export function probeModels(db: Db, ref: string, models: readonly string[], ask: Ask, now: () => number, o: { parallel?: number; timeoutMs?: number } = {}): void {
  const todo = models.filter((m) => !running.has(key(ref, m))).slice(0, PROBE_CAP);
  const queue = [...todo];
  // the first model is asked alone: when that read fails because the Vault key is not on this node, the other lanes never start (one failed read per account, not one per model)
  let firstDone: () => void = () => undefined;
  const first = new Promise<void>((r) => { firstDone = r; });
  const one = async (lane: number): Promise<void> => {
    if (lane > 0) await first;
    for (let m = queue.shift(); m !== undefined; m = queue.shift()) {
      try { await within(ask(ref, m), o.timeoutMs ?? API_PROBE_TIMEOUT_MS); markConfirmed(db, ref, m, now()); }
      catch (e) {
        const text = `${(e as { code?: unknown } | null)?.code ?? ""} ${e instanceof Error ? e.message : String(e)}`;
        if (keyMissing(text)) {
          // one failure for the account, not one per model: the rest of the queue is dropped and the whole account reads "Not checked" for a while
          markNotChecked(ref, null, now());
          for (const left of queue.splice(0)) running.delete(key(ref, left));
        } else if (e instanceof Error && e.message === TOO_LONG) markNotChecked(ref, m, now());
        else if (refusesModel(text)) markUnavailable(db, ref, m, now());
        else markConfirmed(db, ref, m, now());
      }
      finally { running.delete(key(ref, m)); if (lane === 0) firstDone(); }
    }
  };
  const lanes = Array.from({ length: Math.min(o.parallel ?? PROBE_PARALLEL, queue.length) }, (_, i) => one(i));
  const all = Promise.all(lanes).then(() => undefined);
  for (const m of todo) running.set(key(ref, m), all);
}

const TOO_LONG = "the check took too long";
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(TOO_LONG)), ms); (t as { unref?: () => void }).unref?.(); })]).finally(() => { if (t !== undefined) clearTimeout(t); });
}
