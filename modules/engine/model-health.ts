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
export const PROBE_PROMPT = "Reply with the single word: ok";

const ready = new WeakSet<object>();

function ensure(db: Db): void {
  if (ready.has(db as object)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_model_health (account_ref TEXT NOT NULL, model TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (account_ref, model))");
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

/** An API provider's own words for a model it does not serve (a 404, "model_not_found", "does not exist"). Anything else says nothing about the model. */
const REFUSED = /model[_ ]not[_ ]found|no such model|unknown model|invalid model|model .{0,60}(?:does not exist|not found|not available|is not supported|not supported)|\b404\b|do(?:es)? not have access to (?:the )?model/i;
export const refusesModel = (message: string): boolean => modelGone(message) || REFUSED.test(message);

/** Asks one account for one tiny answer on one model. A rejection is the provider's refusal. */
export type Ask = (ref: string, model: string) => Promise<void>;
const running = new Map<string, Promise<void>>();
const key = (ref: string, model: string): string => `${ref}\u0000${model}`;

/** Probes in flight for these accounts, so a read can wait for them. */
export const probing = (refs: readonly string[]): Promise<void>[] => [...running.entries()].filter(([k]) => refs.some((r) => k.startsWith(`${r}\u0000`))).map(([, p]) => p);
export const probeRunning = (ref: string): boolean => [...running.keys()].some((k) => k.startsWith(`${ref}\u0000`));
/** Tests: forget probes in flight. */
export function resetProbes(): void { running.clear(); }

/**
 * Check these models in the background, two at a time: an answer confirms the model, the provider refusing it marks it bad, and anything else (a rate limit, no network, a failed sign-in) says nothing
 * about the model, so it stays shown. Never throws, never waits for the caller.
 */
export function probeModels(db: Db, ref: string, models: readonly string[], ask: Ask, now: () => number): void {
  const todo = models.filter((m) => !running.has(key(ref, m))).slice(0, PROBE_CAP);
  const queue = [...todo];
  const one = async (): Promise<void> => {
    for (let m = queue.shift(); m !== undefined; m = queue.shift()) {
      try { await ask(ref, m); markConfirmed(db, ref, m, now()); }
      catch (e) {
        const text = `${(e as { code?: unknown } | null)?.code ?? ""} ${e instanceof Error ? e.message : String(e)}`;
        if (refusesModel(text)) markUnavailable(db, ref, m, now()); else markConfirmed(db, ref, m, now());
      }
      finally { running.delete(key(ref, m)); }
    }
  };
  const lanes = Array.from({ length: Math.min(PROBE_PARALLEL, queue.length) }, () => one());
  const all = Promise.all(lanes).then(() => undefined);
  for (const m of todo) running.set(key(ref, m), all);
}
