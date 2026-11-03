// The background job of personal keys (owner ruling 3 Nov 2026; personal.ts): every 30 seconds, for each person with memory in this Space whose key the keyring holds now,
//   1. re-seal what is still under the server seal or the public key into their own key, verified, then wipe the old value (resealPerson);
//   2. fold exact duplicates that capture wrote while they were signed out (with no key the write could not see what was already there): the later copy goes to Trash, merged into the earlier;
//   3. warm their in-memory index, so their first turn after signing in does not open every fact.
// A person whose key is not held is skipped, and anything kept in memory for them is dropped. Nothing here needs a key to be held to keep the Space working: it only moves rows forward.
import { normal } from "./factcore.ts";
import { trashFact } from "./handlers/lifecycle.ts";
import { currentPersonFacts, indexOf, openFactText, peopleWithMemory, resealPerson, sweepHeld } from "./personal.ts";
import { ensure, factTitle, orNull, readFact, rowsOf, str, tokOf } from "./projections.ts";
import type { MemCtx } from "./projections.ts";
import { UPKEEP } from "./trail.ts";

export interface SettleOut { people: number; resealed: number; unreadable: number; folded: number; warmed: number; left: number }

export function settlePersonal(ctx: MemCtx, budget = 2000): SettleOut {
  ensure(ctx.db);
  sweepHeld();
  const out: SettleOut = { people: 0, resealed: 0, unreadable: 0, folded: 0, warmed: 0, left: 0 };
  for (const owner of peopleWithMemory(ctx.db)) {
    const r = resealPerson(ctx, owner, budget);
    if (!r) continue;
    out.people++;
    out.resealed += r.resealed;
    out.unreadable += r.unreadable;
    out.left += r.left;
    out.folded += fold(ctx, owner, r.fromPublic);
    out.warmed += warm(ctx, owner);
  }
  return out;
}

/** Facts written to the public key that say exactly what another live fact in the same place says: Trash, merged into the one that was there (or the earliest). */
function fold(ctx: MemCtx, owner: string, ids: string[]): number {
  if (ids.length === 0) return 0;
  const late = new Set(ids);
  const rows = rowsOf(ctx.db, "SELECT * FROM memory_facts WHERE layer = 'person' AND owner_ref = ? AND enc = 2 AND status IN ('current', 'proposed') AND trashed_at IS NULL ORDER BY learned_at, id", owner);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const text = openFactText(ctx, str(r["id"]), owner, str(r["sealed"]));
    if (text === "") continue;
    const k = `${orNull(r["agent_id"]) ?? ""}|${orNull(r["project_id"]) ?? ""}|${normal(text)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let n = 0;
  for (const g of groups.values()) {
    if (g.length < 2 || !g.some((r) => late.has(str(r["id"])))) continue;
    const keep = g.find((r) => !late.has(str(r["id"]))) ?? g[0]!;
    for (const r of g) {
      if (r === keep || !late.has(str(r["id"]))) continue;
      if (trashFact(ctx, readFact(ctx, r), { reason: "duplicate", action: "merge", mergedInto: str(keep["id"]), who: UPKEEP, source: "upkeep:keys" })) n++;
    }
  }
  return n;
}

/** Open the person's live facts into their in-memory index, with the list of their current rows, so their first turn after signing in reads no row of theirs. */
function warm(ctx: MemCtx, owner: string): number {
  const ix = indexOf(ctx, owner);
  if (!ix) return 0;
  currentPersonFacts(ctx, owner);
  let n = 0;
  for (const r of rowsOf(ctx.db, "SELECT id, kind, sealed FROM memory_facts WHERE layer = 'person' AND owner_ref = ? AND status = 'current' AND enc = 2 AND sealed IS NOT NULL", owner)) {
    const id = str(r["id"]);
    if (ix.toks.has(id)) continue;
    const text = openFactText(ctx, id, owner, str(r["sealed"]));
    if (text === "") continue;
    ix.toks.set(id, tokOf(factTitle(orNull(r["kind"])), text));
    n++;
  }
  return n;
}
