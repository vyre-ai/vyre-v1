// Which models an account turned out not to serve (owner ruling, 4 Nov 2026): a turn whose model the engine refused ("may not exist or you may not have access") marks that model unavailable for that
// account. The picker (engine.models.list) leaves it out while the mark stands, so a person is never offered a model that fails. A mark ends after REST_MS, so the model is tried again later and comes
// back by itself when it works; a turn that ran on it clears the mark at once.
import type { Db } from "./projections.ts";

/** How long a model stays off an account's list after it failed. */
export const REST_MS = 2 * 3600_000;
const ready = new WeakSet<object>();

function ensure(db: Db): void {
  if (ready.has(db as object)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_model_unavailable (account_ref TEXT NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (account_ref, model))");
  ready.add(db as object);
}

/** The account did not serve the model just now. */
export function markUnavailable(db: Db, ref: string, model: string, now: number): void {
  ensure(db);
  db.run("INSERT OR REPLACE INTO engine_model_unavailable (account_ref, model, at) VALUES (?, ?, ?)", ref, model, now);
}

/** The models this account is known not to serve right now. */
export function unavailableFor(db: Db, ref: string, now: number): Set<string> {
  ensure(db);
  const rows = db.all("SELECT model FROM engine_model_unavailable WHERE account_ref = ? AND at > ?", ref, now - REST_MS) as Array<{ model: string }>;
  return new Set(rows.map((r) => r.model));
}

/** The model worked on the account (or its sign-in changed): it is listed again. */
export function clearUnavailable(db: Db, ref: string, model?: string): void {
  ensure(db);
  if (model === undefined) db.run("DELETE FROM engine_model_unavailable WHERE account_ref = ?", ref);
  else db.run("DELETE FROM engine_model_unavailable WHERE account_ref = ? AND model = ?", ref, model);
}
