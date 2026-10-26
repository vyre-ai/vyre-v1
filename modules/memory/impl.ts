// memory module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'`; the lane's live packet flips it (ruling 25) after the contract tests
// pass against these handlers. All 30 capabilities of manifests/memory.ts have a handler here.
//
// Also here: the seam for the capture pass. memory.capture asks an extractor which sentences of a closed or idle chat are facts. The default is a set of rules; the host binds a cheap-model
// pass with setCaptureExtractor at boot, which is where permission.provider_label comes from when a chat's label forbids sending it to a provider.
import { handlers as table } from "./handlers/index.ts";
import { setCaptureExtractor, heuristicExtract } from "./handlers/facts.ts";
import type { Candidate, CaptureMessage, Extractor } from "./handlers/facts.ts";
import type { Handler } from "../../host/src/invoke.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { setCaptureExtractor, heuristicExtract };
export type { Candidate, CaptureMessage, Extractor };
export { ensure } from "./projections.ts";

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it (P-L7_21). The host runs them with this module's ctx, so no other module
 * reads these tables. `owned_by` answers { <kind>: { count, sample, ids } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type OwnedRow = Record<string, unknown>;
const ownedRows = (ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } }, sql: string, ...a: unknown[]): OwnedRow[] => { try { return ctx.db.all(sql, ...a) as OwnedRow[]; } catch { return []; } };
const ownedKept = (r: OwnedRow[], type: string, title: string) => ({ count: r.length, sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })), ids: r.slice(0, 500).map((x) => String(x["id"])) });
export const hostCalls = {
  "memory.owned_by": (ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } }, i: { person: string }) => ({
    memory_from_you: ownedKept(ownedRows(ctx, `SELECT "id", "kind" AS "title" FROM memory_facts WHERE "source_person" = ? AND "layer" <> 'person' AND "status" IN ('proposed', 'current')`, i.person), "fact", "title"),
  }),
  "memory.reassign_owned": (ctx: { now(): number; db: { run(sql: string, ...a: unknown[]): { changes: number } } }, i: { person: string; kind: string; action: string }): number => {
    if (i.kind !== "memory_from_you" || i.action !== "delete") return 0;   // keep: the facts stay, with the person named as their source
    try {
      return ctx.db.run(`UPDATE memory_facts SET "status" = 'removed', "closed_at" = ?, "text" = '', "sealed" = NULL WHERE "source_person" = ? AND "layer" <> 'person' AND "status" IN ('proposed', 'current')`, ctx.now(), i.person).changes;
    } catch { return 0; }
  },
};
