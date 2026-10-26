// files (lane L4). The host loads generated stub handlers while status is stub, and this module once the manifest is live.

export { handlers } from "./handlers/index.ts";
export { inline, consumers } from "./projections.ts";
export { putUploadedBytes, MAX_INLINE, MAX_UPLOAD, TRASH_MS } from "./handlers/tree.ts";
export { configureSheets } from "./handlers/index.ts";
export type { SheetsDrivers } from "./handlers/index.ts";

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it (P-L7_21). The host runs them with this module's ctx, so no other module
 * reads these tables. `owned_by` answers { <kind>: { count, sample, ids } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type OwnedRow = Record<string, unknown>;
const ownedRows = (ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } }, sql: string, ...a: unknown[]): OwnedRow[] => { try { return ctx.db.all(sql, ...a) as OwnedRow[]; } catch { return []; } };
const ownedKept = (r: OwnedRow[], type: string, title: string) => ({ count: r.length, sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })), ids: r.slice(0, 500).map((x) => String(x["id"])) });
export const hostCalls = {
  "files.owned_by": (ctx: HostCallCtx, i: { person: string }) => ({
    files: ownedKept([
      ...ownedRows(ctx, `SELECT "id", "name" FROM files_file WHERE "owner" = ? AND "deleted_at" IS NULL`, i.person),
      ...ownedRows(ctx, `SELECT "id", "name" FROM files_folder WHERE "owner" = ? AND "deleted_at" IS NULL AND "system_key" IS NULL AND "root_key" IS NULL`, i.person),
    ], "file", "name"),
  }),
  "files.reassign_owned": (ctx: HostCallCtx, i: { person: string; kind: string; action: string; to?: string }): number => {
    if (i.kind !== "files" || i.action !== "reassign" || !i.to) return 0;   // retain: they stay with the person's name on them
    const now = ctx.now();
    try {
      const a = ctx.db.run(`UPDATE files_file SET "owner" = ?, "updated_at" = ? WHERE "owner" = ? AND "deleted_at" IS NULL`, i.to, now, i.person).changes;
      const b = ctx.db.run(`UPDATE files_folder SET "owner" = ?, "updated_at" = ? WHERE "owner" = ? AND "deleted_at" IS NULL AND "system_key" IS NULL AND "root_key" IS NULL`, i.to, now, i.person).changes;
      return a + b;
    } catch { return 0; }
  },
};
/** The part of the module ctx these calls use. */
interface HostCallCtx { now(): number; db: { all(sql: string, ...a: unknown[]): unknown[]; run(sql: string, ...a: unknown[]): { changes: number } } }
