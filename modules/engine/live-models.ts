// The live model lists of subscription engines (Codex, Claude Code, Grok), per account. The list is the vendor CLI's own answer (agent/src/drivers/cli/models.ts), run as the person's engine
// by the runtime's opener; it is saved per account (engine_model_cache) and served stale-while-revalidate: engine.models.list answers at once with what is saved, starts a refresh when the
// menu opens or the saved list is a day old, and a second call with `wait` picks up the fresh list. A refresh that fails keeps the saved list and says so. With nothing saved (a fresh
// install, no network) the release's shipped catalog (models-catalog.json) answers, so the menu is never empty and never waits on the network.
import { readFileSync } from "node:fs";
import type { LiveModel } from "../../agent/src/drivers/cli/models.ts";
import type { OpenAccount } from "../../agent/src/drivers/open/opener.ts";
import { ensure } from "./projections.ts";
import type { Db } from "./projections.ts";

export type { LiveModel };
export type ModelLister = (account: OpenAccount, asker: string, o?: { timeoutMs?: number }) => Promise<LiveModel[]>;
export type LiveDriver = "codex" | "claude_code" | "grok";
export const LIVE_DRIVERS: ReadonlySet<string> = new Set<LiveDriver>(["codex", "claude_code", "grok"]);

/** A saved list older than this is refreshed at the next read. */
export const DAY_MS = 24 * 3600 * 1000;
/** A menu opened again within this long does not start another run of the CLI. */
export const RETRY_GAP_MS = 30_000;

let lister: ModelLister | null = null;
/** The runtime binds the opener's model list when it is built (runtime.ts); null at shutdown. Tests bind their own. */
export function bindModelLister(l: ModelLister | null): void { lister = l; }

const CATALOG = JSON.parse(readFileSync(new URL("./models-catalog.json", import.meta.url), "utf8")) as Record<LiveDriver, LiveModel[]> & { pins: Record<LiveDriver, string> };
/** The list shipped with this release for an engine (the pinned CLI's own answer, signed out). */
export function shippedModels(driver: string): LiveModel[] {
  return LIVE_DRIVERS.has(driver) ? CATALOG[driver as LiveDriver].map((m) => ({ ...m, ...(m.efforts ? { efforts: [...m.efforts] } : {}) })) : [];
}

interface Saved { models: LiveModel[]; fetchedAt: number | null; triedAt: number | null; error: string | null }

function saved(db: Db, ref: string): Saved | null {
  ensure(db);
  const r = db.all("SELECT models_json, fetched_at, tried_at, error FROM engine_model_cache WHERE account_ref = ?", ref)[0] as { models_json: string | null; fetched_at: number | null; tried_at: number | null; error: string | null } | undefined;
  if (!r) return null;
  let models: LiveModel[] = [];
  try { const v: unknown = JSON.parse(r.models_json ?? "[]"); if (Array.isArray(v)) models = v.filter((m): m is LiveModel => typeof m === "object" && m !== null && typeof (m as LiveModel).id === "string" && (m as LiveModel).id !== ""); } catch { models = []; }
  return { models, fetchedAt: r.fetched_at, triedAt: r.tried_at, error: r.error };
}

function write(db: Db, ref: string, driver: string, at: number, got: { models: LiveModel[] } | { error: string }): void {
  ensure(db);
  if ("models" in got) {
    db.run(`INSERT INTO engine_model_cache (account_ref, driver, models_json, fetched_at, tried_at, error) VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(account_ref) DO UPDATE SET driver = excluded.driver, models_json = excluded.models_json, fetched_at = excluded.fetched_at, tried_at = excluded.tried_at, error = NULL`, ref, driver, JSON.stringify(got.models), at, at);
  } else {
    db.run(`INSERT INTO engine_model_cache (account_ref, driver, models_json, fetched_at, tried_at, error) VALUES (?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(account_ref) DO UPDATE SET tried_at = excluded.tried_at, error = excluded.error`, ref, driver, at, got.error.slice(0, 200));
  }
}

/** Runs in flight, by account: a second menu open while one runs waits on the same run. */
const inflight = new Map<string, Promise<void>>();

/** Ask the engine for the account's list once and save it (or the reason it failed). Never throws. */
export function refreshModels(db: Db, account: { ref: string; driver: string }, asker: string, now: () => number): Promise<void> {
  const running = inflight.get(account.ref);
  if (running) return running;
  const l = lister;
  if (!l) return Promise.resolve();
  const run = (async () => {
    try {
      const got = await l({ ref: account.ref, driver: account.driver, kind: "subscription", payer: asker }, asker);
      // an answer with no model in it is not a list: keep what was there
      if (got.length === 0) write(db, account.ref, account.driver, now(), { error: "The engine listed no models." });
      else write(db, account.ref, account.driver, now(), { models: got });
    } catch (e) {
      write(db, account.ref, account.driver, now(), { error: e instanceof Error ? e.message : "The engine did not list its models." });
    } finally { inflight.delete(account.ref); }
  })();
  inflight.set(account.ref, run);
  return run;
}

/** Where the list came from: the vendor just now or earlier (live), or the release (shipped). `failed`: the last refresh did not answer, so this is the saved or shipped list. */
export interface ModelsState { source: "live" | "shipped"; updatedAt?: number; refreshing: boolean; failed: boolean }

/**
 * The live rows, with the effort levels the shipped catalog knows filled in where the CLI said none (an older CLI). Names, the default and the rows themselves are the account's own: shipped
 * rows are never added to a live list, and the shipped default never marks a live row.
 */
function merged(live: readonly LiveModel[], driver: string): LiveModel[] {
  const ship = new Map(shippedModels(driver).map((m) => [m.id, m]));
  return live.map((m) => {
    const s = ship.get(m.id);
    if (!s || m.efforts) return m;
    return { ...m, ...(s.efforts ? { efforts: s.efforts } : {}), ...(m.defaultEffort === undefined && s.defaultEffort ? { defaultEffort: s.defaultEffort } : {}) };
  });
}

/**
 * The account's models now, and whether a refresh runs. `refresh`: the menu opened (start one unless one ran a moment ago). `waitMs`: wait this long for a run in flight (the menu's
 * second, quiet call). A saved list a day old is refreshed whatever is asked.
 */
export async function modelsFor(db: Db, account: { ref: string; driver: string }, asker: string, o: { now: () => number; refresh?: boolean; waitMs?: number }): Promise<{ models: LiveModel[]; state: ModelsState }> {
  const before = saved(db, account.ref);
  const t = o.now();
  const old = before?.fetchedAt == null || t - before.fetchedAt > DAY_MS;
  const triedLately = before?.triedAt != null && t - before.triedAt < RETRY_GAP_MS;
  if (lister && !inflight.has(account.ref) && ((o.refresh === true && !triedLately) || (old && !triedLately))) void refreshModels(db, account, asker, o.now);
  const running = inflight.get(account.ref);
  if (running && o.waitMs !== undefined && o.waitMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([running, new Promise<void>((r) => { timer = setTimeout(r, o.waitMs); })]);
    if (timer !== undefined) clearTimeout(timer);
  }
  const now = saved(db, account.ref);
  const refreshing = inflight.has(account.ref);
  const failed = now?.error != null && now.triedAt != null && (now.fetchedAt == null || now.triedAt > now.fetchedAt);
  if (now && now.models.length > 0) return { models: merged(now.models, account.driver), state: { source: "live", ...(now.fetchedAt != null ? { updatedAt: now.fetchedAt } : {}), refreshing, failed } };
  return { models: shippedModels(account.driver), state: { source: "shipped", refreshing, failed } };
}

/** The model a pick means in this list: its id, or the id an alias resolves to today (Claude Code's opus, sonnet). A pick the list does not know is passed on as it is. */
export function resolvePick(models: readonly LiveModel[], pick: string): string {
  if (models.some((m) => m.id === pick)) return pick;
  return models.find((m) => m.alias === pick)?.id ?? pick;
}

/** Tests: forget runs in flight. */
export function resetLiveModels(): void { inflight.clear(); }
