// One-time clean-up (owner, 4 Nov 2026): holds an agent raised for a placeholder call (example.com, "test", __probe_none__) are dropped, and their tasks go from Needs you. A hold is dropped only when
// lib/probe.ts finds a placeholder in its input; every other hold waits for its person as before.
import { probeIn } from "../../../lib/probe.ts";
import type { GateCtx } from "../projections.ts";
import { holdsWhere } from "../projections.ts";
import { dropHold } from "./approve.ts";

const FLAG = 'CREATE TABLE IF NOT EXISTS "gate_cleanup_done" ("name" TEXT PRIMARY KEY, "at" INTEGER NOT NULL, "dropped" INTEGER NOT NULL)';
const NAME = "placeholder_holds_v1";

export async function dropPlaceholderHolds(ctx: GateCtx, o: { force?: boolean } = {}): Promise<{ dropped: number; ran: boolean }> {
  ctx.db.run(FLAG);
  if (!o.force && ctx.db.all('SELECT 1 AS x FROM "gate_cleanup_done" WHERE "name" = ?', NAME).length > 0) return { dropped: 0, ran: false };
  let dropped = 0;
  for (const h of holdsWhere(ctx.db, "state = 'held'")) {
    if (probeIn(h.input) === null) continue;
    await dropHold(ctx, h, "Dropped: it was a test call with placeholder content.");
    dropped += 1;
  }
  ctx.db.run('INSERT OR REPLACE INTO "gate_cleanup_done" ("name", "at", "dropped") VALUES (?, ?, ?)', NAME, ctx.now(), dropped);
  return { dropped, ran: true };
}
