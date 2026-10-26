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
  // "From you": the facts a person contributed to a shared layer, and their own person-layer facts. The first belong to the Space once they are gone; the second go with them (P-L7_21).
  "memory.owned_by": (ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } }, i: { person: string }) => ({
    memory_from_you: ownedKept(ownedRows(ctx,
      `SELECT "id", "kind" AS "title" FROM memory_facts WHERE "status" IN ('proposed', 'current') AND (("source_person" = ? AND "layer" <> 'person') OR ("layer" = 'person' AND "owner_ref" = ?))`, i.person, i.person), "fact", "title"),
  }),
  /**
   * keep (the default): facts the person contributed to a shared layer stay, text and all, and become the Space's: only the authorship link is dropped (source_person becomes the Space). Their own
   * person-layer facts are theirs and go. delete (the admin picked it): the shared facts go too, with their text.
   */
  "memory.reassign_owned": (ctx: { space: string; now(): number; db: { run(sql: string, ...a: unknown[]): { changes: number } } }, i: { person: string; kind: string; action: string }): number => {
    if (i.kind !== "memory_from_you" || (i.action !== "keep" && i.action !== "delete")) return 0;
    const now = ctx.now();
    try {
      const own = ctx.db.run(`UPDATE memory_facts SET "status" = 'removed', "closed_at" = ?, "text" = '', "sealed" = NULL WHERE "layer" = 'person' AND "owner_ref" = ? AND "status" IN ('proposed', 'current')`, now, i.person).changes;
      if (i.action === "keep") return own + ctx.db.run(`UPDATE memory_facts SET "source_person" = ? WHERE "source_person" = ? AND "layer" <> 'person' AND "status" IN ('proposed', 'current')`, ctx.space, i.person).changes;
      return own + ctx.db.run(`UPDATE memory_facts SET "status" = 'removed', "closed_at" = ?, "text" = '', "sealed" = NULL WHERE "source_person" = ? AND "layer" <> 'person' AND "status" IN ('proposed', 'current')`, now, i.person).changes;
    } catch { return 0; }
  },
};
