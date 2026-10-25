// search module entry (lane L1). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// All ten capabilities of manifests/search.ts have a handler here. Also here: what the module reads from the event log. `consumers` lists, by name, the events each one reads and
// what it does with one; the host runs them after commit, at least once, so each is safe to repeat. `search.fts` keeps the full text index current, `search.vectors` computes
// the vectors of what changed. Seams the host fills: the embedding model (`setEmbedder`), a source for an entity the module cannot read itself (`setSource`), and a lister for a rebuild (`setLister`).
import type { Handler } from "../../host/src/invoke.ts";
import { embedRun, handlers as table, indexApply, setLister, DEFAULT_SOURCES } from "./handlers/index.ts";
import { forgetVectors, setEmbedder, setSource } from "./projections.ts";
import type { Embedder, Source, SearchCtx } from "./projections.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;
export { mergeHits } from "./handlers/query.ts";
export { setEmbedder, setLister, setSource, forgetVectors, DEFAULT_SOURCES };
export type { Embedder, Source };
export { ensure } from "./projections.ts";

/** What a consumer reads of an event: its name, its sequence, whether it is end-to-end (enc = 2) and the payload. */
export interface IndexEvent { type: string; seq: number; enc?: number; entity?: string; entityId?: string; payload: Record<string, unknown> }

/** The events that change what the index holds: which entity, which payload key holds its id, and whether the event removes it. */
export const WATCHED: Readonly<Record<string, { entity: string; idKey: string; remove?: boolean }>> = {
  "record.created": { entity: "record", idKey: "recordId" }, "record.updated": { entity: "record", idKey: "recordId" }, "record.restored": { entity: "record", idKey: "recordId" },
  "record.merged": { entity: "record", idKey: "recordId" }, "record.deleted": { entity: "record", idKey: "recordId", remove: true },
  "file.created": { entity: "file", idKey: "fileId" }, "file.renamed": { entity: "file", idKey: "fileId" }, "file.moved": { entity: "file", idKey: "fileId" },
  "file.version_added": { entity: "file", idKey: "fileId" }, "file.restored": { entity: "file", idKey: "fileId" },
  "file.deleted": { entity: "file", idKey: "fileId", remove: true }, "file.purged": { entity: "file", idKey: "fileId", remove: true },
  "thread.started": { entity: "thread", idKey: "threadId" }, "thread.updated": { entity: "thread", idKey: "threadId" }, "thread.replied": { entity: "thread", idKey: "threadId" },
  "message.received": { entity: "thread", idKey: "threadId" }, "message.sent": { entity: "thread", idKey: "threadId" }, "message.edited": { entity: "thread", idKey: "threadId" },
  "message.deleted": { entity: "thread", idKey: "threadId" },
  "agent.created": { entity: "agent", idKey: "agentId" }, "agent.config_changed": { entity: "agent", idKey: "agentId" }, "agent.restored": { entity: "agent", idKey: "agentId" },
  "agent.deleted": { entity: "agent", idKey: "agentId", remove: true },
  "automation.created": { entity: "automation", idKey: "automationId" }, "automation.updated": { entity: "automation", idKey: "automationId" },
  "automation.restored": { entity: "automation", idKey: "automationId" }, "automation.deleted": { entity: "automation", idKey: "automationId", remove: true },
  "task.created": { entity: "task", idKey: "taskId" }, "task.updated": { entity: "task", idKey: "taskId" }, "task.transitioned": { entity: "task", idKey: "taskId" },
  "channel.created": { entity: "channel", idKey: "channelId" }, "channel.updated": { entity: "channel", idKey: "channelId" }, "channel.unarchived": { entity: "channel", idKey: "channelId" },
  "channel.archived": { entity: "channel", idKey: "channelId", remove: true },
};

/** The entity row an event is about, or null when it is not one the index follows or it is end-to-end. */
export function targetOf(e: IndexEvent): { entity: string; id: string; op: "upsert" | "delete"; seq: number } | null {
  const w = WATCHED[e.type];
  if (!w || e.enc === 2) return null;
  const id = typeof e.payload[w.idKey] === "string" ? (e.payload[w.idKey] as string) : e.entityId;
  if (!id) return null;
  const type = w.entity === "record" && typeof e.payload["type"] === "string" ? `record:${e.payload["type"] as string}` : w.entity;
  return { entity: type, id, op: w.remove ? "delete" : "upsert", seq: e.seq };
}

export const consumers = {
  /** A changed row is read again and put in the full text index (or taken out when it was removed, hidden or turned out to be end-to-end). */
  "search.fts": {
    on: Object.keys(WATCHED),
    run: async (ctx: SearchCtx, event: IndexEvent): Promise<void> => {
      const t = targetOf(event);
      if (t) await indexApply(ctx, t);
    },
  },
  /** What changed gets its vector within seconds: the newest documents without one are embedded in a small batch. */
  "search.vectors": {
    on: Object.keys(WATCHED),
    run: async (ctx: SearchCtx, event: IndexEvent): Promise<void> => {
      if (targetOf(event)) await embedRun(ctx, { limit: 50 });
    },
  },
};
