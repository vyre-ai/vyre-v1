// Bulk seed for the snapshot tests: rows go straight into `sync_rows`, the table a snapshot page is cut from, so 100,000 rows take a second and not a hundred thousand log appends.
// They sit at seq 0, below every event the test then appends, so the snapshot is as of seq 0 and later events are the pull. Rows carry the shape the fold writes: a cell {v, hlc, actor, seq} per field.
import type { ProjectionHost } from "../../../kernel/src/store/projection.ts";
import { NOW } from "./world.ts";

const REGIONS = ["eu", "us", "apac", "latam"] as const;
const STAGES = ["lead", "won", "lost"] as const;

export interface SeedOpts { entity?: string; count: number; seq?: number; owner?: string }

/** Row i has id c000001-style, region REGIONS[i % 4], and updated_at NOW - i seconds (so row 0 is the newest). */
export function seedContacts(host: ProjectionHost, o: SeedOpts): number {
  const entity = o.entity ?? "contact";
  const seq = o.seq ?? 0;
  const tx = host.tx;
  tx.exec("BEGIN IMMEDIATE");
  try {
    const hlc = "000000000001-0001-srv";
    const ins = "INSERT INTO sync_rows (entity, id, owner_id, label, holds, deleted, enc, vis, seq, updated_at, fields) VALUES (?, ?, ?, 0, 0, 0, 0, 'space', ?, ?, ?)";
    for (let i = 0; i < o.count; i++) {
      const cell = (v: unknown) => ({ v, hlc, actor: "svc_import", seq });
      const fields = {
        name: cell(`Contact ${i}`), email: cell(`c${i}@example.com`), phone: cell(`+1555${String(i).padStart(7, "0")}`),
        region: cell(REGIONS[i % 4]), stage: cell(STAGES[i % 3]), owner: cell(o.owner ?? "usr_ada"), amount: cell(i % 1000),
      };
      tx.run(ins, entity, `c${String(i).padStart(6, "0")}`, o.owner ?? "usr_ada", seq, NOW - i * 1000, JSON.stringify(fields));
    }
    tx.exec("COMMIT");
  } catch (e) {
    try { tx.exec("ROLLBACK"); } catch { /* keep the first failure */ }
    throw e;
  }
  return o.count;
}
