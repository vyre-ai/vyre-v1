import { eraseTables, eraseWhere, tryAll, tryRun } from "../../lib/erase-agent.ts";
import type { EraseCtx, EraseIn, Footprint } from "../../lib/erase-agent.ts";
// search module entry (lane L1). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// All ten capabilities of manifests/search.ts have a handler here. Also here: what the module reads from the event log. `consumers` lists, by name, the events each one reads and
// what it does with one; the host runs them after commit, at least once, so each is safe to repeat. `search.fts` keeps the full text index current, `search.vectors` computes
// the vectors of what changed. Seams the host fills: the embedding model (`setEmbedder`), a source for an entity the module cannot read itself (`setSource`), and a lister for a rebuild (`setLister`).
import type { Handler } from "../../host/src/invoke.ts";
import {
  embedRun,
  handlers as table,
  indexApply,
  indexDropFolder,
  noteTitleChange,
  notePrivate,
  retitleRun,
  setLister,
  DEFAULT_SOURCES,
} from "./handlers/index.ts";
import { forgetVectors, rowsOf, setEmbedder, setSource } from "./projections.ts";
import type { Embedder, Source, SearchCtx } from "./projections.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;
export { mergeHits } from "./handlers/query.ts";
export { setEmbedder, setLister, setSource, forgetVectors, DEFAULT_SOURCES };
export type { Embedder, Source };
export { ensure } from "./projections.ts";

/** What a consumer reads of an event: its name, its sequence, whether it is private (enc = 2) and the payload. */
/** What the host hands a consumer (`name`, `subject` as entity/id), as opposed to the stored shape (`type`, `entityId`) the index logic and its tests use. */
export interface HostEvent {
  name: string;
  seq: number;
  subject?: string;
  payload: Record<string, unknown>;
}
/** Accept either shape: the live host's event is turned into the stored one, so what the host sends reaches the index. */
export function indexEventOf(e: IndexEvent | HostEvent): IndexEvent {
  if ("type" in e) return e;
  const at = (e.subject ?? "").indexOf("/");
  return {
    type: e.name,
    seq: e.seq,
    enc: 0,
    ...(at > 0 ? { entity: e.subject!.slice(0, at), entityId: e.subject!.slice(at + 1) } : {}),
    payload: e.payload,
  };
}

export interface IndexEvent {
  type: string;
  seq: number;
  enc?: number;
  entity?: string;
  entityId?: string;
  payload: Record<string, unknown>;
}

/** The events that change what the index holds: which entity, which payload key holds its id, and whether the event removes it. */
export const WATCHED: Readonly<
  Record<
    string,
    {
      entity: string;
      idKey: string;
      remove?: boolean;
      /** a second row the event takes out of the index (a merge: the merged-away record) */ alsoRemove?: string;
    }
  >
> = {
  "record.created": { entity: "record", idKey: "recordId" },
  "record.updated": { entity: "record", idKey: "recordId" },
  "record.restored": { entity: "record", idKey: "recordId" },
  "record.merged": { entity: "record", idKey: "survivorId", alsoRemove: "mergedId" },
  "record.deleted": { entity: "record", idKey: "recordId", remove: true },
  "file.created": { entity: "file", idKey: "fileId" },
  "file.renamed": { entity: "file", idKey: "fileId" },
  "file.moved": { entity: "file", idKey: "fileId" },
  "file.version_added": { entity: "file", idKey: "fileId" },
  "file.restored": { entity: "file", idKey: "fileId" },
  "file.deleted": { entity: "file", idKey: "fileId", remove: true },
  // a folder in Trash takes the index entries of its files with it (the consumer drops them by folder; the folder itself is not indexed)
  "folder.deleted": { entity: "folder", idKey: "folderId", remove: true },
  "file.purged": { entity: "file", idKey: "fileId", remove: true },
  // Redaction for AI: the index holds what an agent may read of a file (files.agent_view), so a change to its layer or its Agent access reads it again
  "file.redacted": { entity: "file", idKey: "fileId" },
  "file.unredacted": { entity: "file", idKey: "fileId" },
  "file.highlighted": { entity: "file", idKey: "fileId" },
  "file.reviewed": { entity: "file", idKey: "fileId" },
  "file.needs_review": { entity: "file", idKey: "fileId" },
  "file.agent_access_changed": { entity: "file", idKey: "fileId" },
  "thread.started": { entity: "thread", idKey: "threadId" },
  "thread.updated": { entity: "thread", idKey: "threadId" },
  "thread.replied": { entity: "thread", idKey: "threadId" },
  "message.received": { entity: "thread", idKey: "threadId" },
  "message.edited": { entity: "thread", idKey: "threadId" },
  "message.deleted": { entity: "thread", idKey: "threadId" },
  "agent.created": { entity: "agent", idKey: "agentId" },
  // an agent that became private leaves the index; one that stopped being so is read again
  "agent.privacy_set": { entity: "agent", idKey: "agentId" },
  "agent.config_changed": { entity: "agent", idKey: "agentId" },
  "agent.restored": { entity: "agent", idKey: "agentId" },
  "agent.deleted": { entity: "agent", idKey: "agentId", remove: true },
  "automation.created": { entity: "automation", idKey: "automationId" },
  "automation.updated": { entity: "automation", idKey: "automationId" },
  "automation.restored": { entity: "automation", idKey: "automationId" },
  "automation.deleted": { entity: "automation", idKey: "automationId", remove: true },
  "task.created": { entity: "task", idKey: "taskId" },
  "task.updated": { entity: "task", idKey: "taskId" },
  "task.transitioned": { entity: "task", idKey: "taskId" },
  // a deleted task leaves search, and one that comes back or changes hands is read again (l-tasks)
  "task.deleted": { entity: "task", idKey: "taskId", remove: true },
  "task.restored": { entity: "task", idKey: "taskId" },
  "task.assigned": { entity: "task", idKey: "taskId" },
  "task.withdrawn": { entity: "task", idKey: "taskId" },
  "task.completed": { entity: "task", idKey: "taskId" },
  "channel.created": { entity: "channel", idKey: "channelId" },
  "channel.updated": { entity: "channel", idKey: "channelId" },
  "channel.unarchived": { entity: "channel", idKey: "channelId" },
  "channel.archived": { entity: "channel", idKey: "channelId", remove: true },
};

export interface IndexTarget {
  entity: string;
  id: string;
  op: "upsert" | "delete";
  seq: number;
}

/** The entity rows an event is about, or none when it is not one the index follows or it is private. A merge has two: the merged-away record leaves, the survivor is read again. */
export function targetsOf(e: IndexEvent): IndexTarget[] {
  const w = WATCHED[e.type];
  if (!w || e.enc === 2) return [];
  const id = typeof e.payload[w.idKey] === "string" ? (e.payload[w.idKey] as string) : e.entityId;
  if (!id) return [];
  const type =
    w.entity === "record" && typeof e.payload["type"] === "string" ? `record:${e.payload["type"] as string}` : w.entity;
  const out: IndexTarget[] = [];
  const gone = w.alsoRemove !== undefined ? e.payload[w.alsoRemove] : undefined;
  if (typeof gone === "string") out.push({ entity: type, id: gone, op: "delete", seq: e.seq });
  out.push({ entity: type, id, op: w.remove ? "delete" : "upsert", seq: e.seq });
  return out;
}

/** A file's first version is announced right after its creation, and the creation already reads the file whole: the first version is read a second time only when the file is not in the index yet (a flow that adds its first version later is still indexed). */
export function alreadyIndexed(ctx: SearchCtx, e: IndexEvent, t: IndexTarget): boolean {
  if (e.type !== "file.version_added" || e.payload["n"] !== 1) return false;
  return (
    rowsOf(ctx.db, "SELECT 1 AS x FROM search_docs WHERE entity = ? AND id = ? LIMIT 1", t.entity, t.id).length > 0
  );
}

/** The single row an event is about (the last of its targets): what a one-row event means. */
export function targetOf(e: IndexEvent): IndexTarget | null {
  return targetsOf(e).at(-1) ?? null;
}

export const consumers = {
  /** A changed row is read again and put in the full text index (or taken out when it was removed, hidden or turned out to be private). */
  "search.fts": {
    on: Object.keys(WATCHED),
    run: async (ctx: SearchCtx, event: IndexEvent | HostEvent): Promise<void> => {
      const e = indexEventOf(event);
      notePrivate(ctx.space, e);
      if (e.type === "folder.deleted") {
        const folderId = typeof e.payload["folderId"] === "string" ? e.payload["folderId"] : e.entityId;
        if (folderId) indexDropFolder(ctx, folderId, e.seq);
        return;
      }
      for (const t of targetsOf(e)) if (!alreadyIndexed(ctx, e, t)) await indexApply(ctx, t);
    },
  },
  /** A type's schema changed: if its title field did, its documents are marked to be titled again (see search.retitle). */
  "search.titles": {
    on: ["schema.changed"],
    run: async (ctx: SearchCtx, event: IndexEvent | HostEvent): Promise<void> => {
      const e = indexEventOf(event);
      const types = Array.isArray(e.payload["types"])
        ? (e.payload["types"] as unknown[]).filter((x): x is string => typeof x === "string")
        : typeof e.payload["type"] === "string"
          ? [e.payload["type"]]
          : [];
      if (types.length > 0) await noteTitleChange(ctx, types, e.seq);
    },
  },
  /** What changed gets its vector within seconds: the newest documents without one are embedded in a small batch. */
  "search.vectors": {
    on: Object.keys(WATCHED),
    run: async (ctx: SearchCtx, event: IndexEvent | HostEvent): Promise<void> => {
      const e = indexEventOf(event);
      if (targetsOf(e).some((t) => !alreadyIndexed(ctx, e, t))) await embedRun(ctx, { limit: 50 });
    },
  },
};

/** Documents whose type got a new title field are titled again, a page of a hundred every few seconds, so a rename never holds the loop or the other consumers. */
export const periodic = {
  "search.retitle": {
    everyMs: 3_000,
    run: async (ctx: SearchCtx): Promise<number> => retitleRun(ctx),
  },
};

/** Delete an agent for good (F77): what this module holds of it is cleared when the agents module asks (lib/erase-agent.ts). */
export const hostCalls = {
  "search.erase_agent": (ctx: EraseCtx, i: EraseIn): Footprint => {
    if (i.dry === true) return {};
    // the agent's own entry, and what the index kept of anything under its folder
    const docs = tryAll(
      ctx.db,
      `SELECT n FROM search_docs WHERE (entity = 'agent' AND id = ?) OR (res_type = 'agent' AND res_id = ?) OR folder_id = ?`,
      i.agentId,
      i.agentId,
      i.folderId ?? "",
    );
    for (const d of docs) {
      const n = Number(d["n"]);
      tryRun(ctx.db, `DELETE FROM search_fts WHERE rowid = ?`, n);
      tryRun(ctx.db, `DELETE FROM search_vectors WHERE n = ?`, n);
      tryRun(ctx.db, `DELETE FROM search_agent_docs WHERE n = ?`, n);
      tryRun(ctx.db, `DELETE FROM search_docs WHERE n = ?`, n);
    }
    return {};
  },
};
