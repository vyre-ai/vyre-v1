// memory module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'`; the lane's live packet flips it (ruling 25) after the contract tests
// pass against these handlers. All 30 capabilities of manifests/memory.ts have a handler here.
//
// Also here: the seam for the capture pass. memory.capture asks an extractor which sentences of a closed or idle chat are facts. The default is a set of rules; the host binds a cheap-model
// pass with setCaptureExtractor at boot, which is where permission.provider_label comes from when a chat's label forbids sending it to a provider.
import { eraseWhere, tryAll, tryRun } from "../../lib/erase-agent.ts";
import type { EraseInput, Footprint } from "../../lib/erase-agent.ts";
type EraseDb = { run(sql: string, ...a: unknown[]): { changes: number }; all(sql: string, ...a: unknown[]): unknown[] };
import { handlers as table } from "./handlers/index.ts";
import { setCaptureExtractor, heuristicExtract } from "./handlers/facts.ts";
import { configureMeaning } from "./meaning.ts";
import type { MeaningHost } from "./meaning.ts";
import type { Candidate, CaptureMessage, Extractor } from "./handlers/facts.ts";
import type { Handler } from "../../host/src/invoke.ts";
import { setMemoryKeyPort } from "./personal.ts";
import type { MemoryKeyPort } from "./personal.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export { setCaptureExtractor, heuristicExtract };
export type { Candidate, CaptureMessage, Extractor };
export { ensure } from "./projections.ts";
export { setEmbedder, configureMeaning } from "./meaning.ts";
export type { Embedder, MeaningHost } from "./meaning.ts";
export { setUpkeepModel } from "./handlers/upkeep.ts";
export { setLearnSeams, shouldLearn } from "./handlers/learn.ts";
export type { LearnSeams, LearnThread } from "./handlers/learn.ts";
export type { UpkeepAction, UpkeepModel, UpkeepRequest, UpkeepResult, UpkeepScope } from "./handlers/upkeep.ts";
export { periodic } from "./hooks.ts";
export { setMemoryKeyPort } from "./personal.ts";
export type { MemoryKeyPort } from "./personal.ts";

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it (P-L7_21). The host runs them with this module's ctx, so no other module
 * reads these tables. `owned_by` answers { <kind>: { count, sample, ids } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type OwnedRow = Record<string, unknown>;
const ownedRows = (
  ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } },
  sql: string,
  ...a: unknown[]
): OwnedRow[] => {
  try {
    return ctx.db.all(sql, ...a) as OwnedRow[];
  } catch {
    return [];
  }
};
const ownedKept = (r: OwnedRow[], type: string, title: string) => ({
  count: r.length,
  sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })),
  ids: r.slice(0, 500).map((x) => String(x["id"])),
});
export const hostCalls = {
  /**
   * Delete for good (F77): everything of an agent's memory, of every layer: facts and the ones it proposed, lessons, summaries, pages with their versions, links and mentions, the graph, its map, its questions and
   * promotions, and the embeddings and index entries of each. The trail keeps ids only (it never held content). Safe to run again.
   */
  "memory.erase_agent": (ctx: { db: EraseDb }, i: EraseInput): Footprint => {
    const db = ctx.db;
    const facts = tryAll(
      db,
      `SELECT id FROM memory_facts WHERE layer = 'agent' AND (agent_id = ? OR (proposed_by = ? AND status = 'proposed'))`,
      i.agentId,
      i.agentId,
    ).map((r) => String(r["id"]));
    const pages = tryAll(
      db,
      `SELECT page_id AS id FROM memory_pages WHERE agent_id = ? AND layer = 'agent'`,
      i.agentId,
    ).map((r) => String(r["id"]));
    const notes = tryAll(
      db,
      `SELECT note_id AS id FROM memory_notes WHERE agent_id = ? AND layer = 'agent'`,
      i.agentId,
    ).map((r) => String(r["id"]));
    const nodes = tryAll(
      db,
      `SELECT node_id AS id FROM memory_graph_nodes WHERE agent_id = ? AND layer = 'agent'`,
      i.agentId,
    ).map((r) => String(r["id"]));
    const count = facts.length + pages.length + notes.length;
    if (i.dry) return { memory: count };
    for (const id of facts) {
      tryRun(db, `DELETE FROM memory_fact_links WHERE fact_id = ?`, id);
      tryRun(db, `DELETE FROM memory_vectors WHERE doc_kind = 'fact' AND doc_id = ?`, id);
      tryRun(db, `DELETE FROM memory_promotions WHERE fact_id = ? OR new_fact_id = ?`, id, id);
      tryRun(db, `DELETE FROM memory_facts WHERE id = ?`, id);
    }
    for (const id of pages) {
      tryRun(db, `DELETE FROM memory_page_versions WHERE page_id = ?`, id);
      tryRun(db, `DELETE FROM memory_page_links WHERE from_page = ? OR to_page = ?`, id, id);
      tryRun(db, `DELETE FROM memory_mentions WHERE page_id = ?`, id);
      tryRun(db, `DELETE FROM memory_vectors WHERE doc_kind = 'page' AND doc_id = ?`, id);
      tryRun(db, `DELETE FROM memory_pages WHERE page_id = ?`, id);
    }
    for (const id of notes) {
      tryRun(db, `DELETE FROM memory_vectors WHERE doc_kind = 'note' AND doc_id = ?`, id);
      tryRun(db, `DELETE FROM memory_notes WHERE note_id = ?`, id);
    }
    for (const id of nodes) {
      tryRun(db, `DELETE FROM memory_graph_edges WHERE from_id = ? OR to_id = ?`, id, id);
      tryRun(db, `DELETE FROM memory_graph_links WHERE from_id = ?`, id);
      tryRun(db, `DELETE FROM memory_layouts WHERE node_id = ?`, id);
    }
    for (const t of ["memory_graph_nodes", "memory_questions"])
      tryRun(db, `DELETE FROM ${t} WHERE agent_id = ? AND layer = 'agent'`, i.agentId);
    eraseWhere(db, i.agentId, [
      ["memory_maps", "agent_id"],
      ["memory_promotions", "agent_id"],
    ]);
    // a person's memory is the person's: a fact, page or note of any other layer that carried this agent's id keeps its row and loses only the agent scope
    for (const t of ["memory_facts", "memory_pages", "memory_notes", "memory_graph_nodes", "memory_questions"])
      tryRun(db, `UPDATE ${t} SET agent_id = NULL WHERE agent_id = ? AND layer <> 'agent'`, i.agentId);
    return { memory: count };
  },
  // "From you": the facts a person contributed to a shared layer, and their own person-layer facts. The first belong to the Space once they are gone; the second go with them (P-L7_21).
  "memory.owned_by": (ctx: { db: { all(sql: string, ...a: unknown[]): unknown[] } }, i: { person: string }) => ({
    memory_from_you: ownedKept(
      ownedRows(
        ctx,
        `SELECT "id", "kind" AS "title" FROM memory_facts WHERE "status" IN ('proposed', 'current') AND (("source_person" = ? AND "layer" <> 'person') OR ("layer" = 'person' AND "owner_ref" = ?))`,
        i.person,
        i.person,
      ),
      "fact",
      "title",
    ),
  }),
  /**
   * keep (the default): facts the person contributed to a shared layer stay, text and all, and become the Space's: only the authorship link is dropped (source_person becomes the Space). Their own
   * person-layer facts are theirs and go. delete (the admin picked it): the shared facts go too, with their text.
   */
  "memory.reassign_owned": (
    ctx: { space: string; now(): number; db: { run(sql: string, ...a: unknown[]): { changes: number } } },
    i: { person: string; kind: string; action: string },
  ): number => {
    if (i.kind !== "memory_from_you" || (i.action !== "keep" && i.action !== "delete")) return 0;
    const now = ctx.now();
    try {
      const own = ctx.db.run(
        `UPDATE memory_facts SET "status" = 'removed', "closed_at" = ?, "text" = '', "sealed" = NULL WHERE "layer" = 'person' AND "owner_ref" = ? AND "status" IN ('proposed', 'current')`,
        now,
        i.person,
      ).changes;
      if (i.action === "keep")
        return (
          own +
          ctx.db.run(
            `UPDATE memory_facts SET "source_person" = ? WHERE "source_person" = ? AND "layer" <> 'person' AND "status" IN ('proposed', 'current')`,
            ctx.space,
            i.person,
          ).changes
        );
      return (
        own +
        ctx.db.run(
          `UPDATE memory_facts SET "status" = 'removed', "closed_at" = ?, "text" = '', "sealed" = NULL WHERE "source_person" = ? AND "layer" <> 'person' AND "status" IN ('proposed', 'current')`,
          now,
          i.person,
        ).changes
      );
    } catch {
      return 0;
    }
  },
};

/**
 * What the host binds at boot, by name: what it runs locally for meaning search (a small embedding model on this server), and the keyring's person keys, for a person's own memory
 * (owner ruling 3 Nov 2026, personal.ts).
 */
export const hostSeams = {
  setMemoryMeaningHost: (host: MeaningHost | null): void => configureMeaning(host),
  setMemoryKeyPort: (port: MemoryKeyPort | null): void => setMemoryKeyPort(port),
};
