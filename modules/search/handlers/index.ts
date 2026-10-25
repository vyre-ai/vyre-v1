// The index side of the search module (spec b11; ARCH 4.3 consumers search.fts and search.vectors): the sources that turn an entity row into a document, search.index.apply, the embeddings
// consumer, the rebuild, the stats and the health probe, and the two small writes Recent needs. The handler table at the bottom holds all ten capabilities of manifests/search.ts.
// End-to-end content never reaches the index: a source answers `e2e` for a private chat, a Restricted row or an encrypted message, and apply then removes whatever was there.
import { askerOf, embed, ensure, mintId, num, putDoc, removeDoc, rowsOf, str, vectorsOf, writeVector, sourceFor } from "../projections.ts";
import type { IndexDoc, Resolved, SearchCtx, Source } from "../projections.ts";
import { actionsList, query, recentList, related } from "./query.ts";

const NOT_FOUND = new Set(["validation.not_found", "permission.not_found"]);
const codeOf = (e: unknown): string => (e as { error?: { code?: string }; code?: string } | null)?.error?.code ?? (e as { code?: string } | null)?.code ?? "";

/** Read through a capability; a missing or hidden row is `null`, any other failure is the caller's to handle. */
async function read<T>(ctx: SearchCtx, cap: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    return (await ctx.call(cap, input)) as T;
  } catch (e) {
    if (NOT_FOUND.has(codeOf(e))) return null;
    throw e;
  }
}

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const gone: Resolved = { skip: "gone" };
const e2e: Resolved = { skip: "e2e" };
const SECRET = /pass(word|phrase)?|secret|token|api.?key|credential/i;

/** The words of a record's fields: strings, numbers and lists of strings; nothing that looks like a credential. */
function fieldWords(fields: Record<string, unknown>, skip: string): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === skip || SECRET.test(k)) continue;
    if (typeof v === "string") out.push(v);
    else if (typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.push(x);
  }
  return out.join(" ");
}

const labelOf = (v: unknown): number => Math.max(0, Math.min(3, Math.trunc(num(v))));

const recordSource: Source = async (ctx, id, sub) => {
  const got = await read<{ record?: Record<string, unknown> }>(ctx, "records.get", { recordId: id, ...(sub ? { type: sub } : {}) });
  const r = got?.record;
  if (!r || r["deletedAt"] !== undefined) return gone;
  const label = labelOf(r["label"]);
  if (label >= 3) return e2e;
  const type = text(r["type"]) || sub || "";
  const fields = rec(r["fields"]);
  let titleField = "";
  if (type) {
    const t = await read<{ type?: Record<string, unknown> }>(ctx, "schema.types.get", { type });
    titleField = text(t?.type?.["titleField"]);
  }
  const first = Object.entries(fields).find(([, v]) => typeof v === "string" && v.length > 0);
  const title = (titleField && typeof fields[titleField] === "string" ? (fields[titleField] as string) : first ? (first[1] as string) : id).slice(0, 300);
  const doc: IndexDoc = {
    entity: sub ? `record:${sub}` : "record", id, kind: "record", title, body: fieldWords(fields, titleField), link: `vyre://record/${id}`, label,
    resource: { type: "record", id }, ...(type ? { recordType: type } : {}), ...(typeof r["updatedAt"] === "number" ? { updatedAt: r["updatedAt"] } : {}),
  };
  return { doc };
};

const TEXTUAL = new Set(["text", "markdown", "code", "document"]);

const fileSource: Source = async (ctx, id) => {
  const got = await read<{ file?: Record<string, unknown> }>(ctx, "files.get", { fileId: id });
  const f = got?.file;
  if (!f || f["deletedAt"] !== undefined) return gone;
  const label = labelOf(f["label"]);
  if (label >= 3) return e2e;
  const name = text(f["name"]) || id;
  const folderId = text(f["folderId"]);
  let path = name;
  if (folderId) {
    const fo = await read<{ folder?: Record<string, unknown> }>(ctx, "files.folder.get", { folderId });
    const p = text(fo?.folder?.["path"]);
    if (p) path = `${p.replace(/\/$/, "")}/${name}`;
  }
  let body = "";
  if (TEXTUAL.has(text(f["kind"]))) {
    const r = await read<{ text?: string }>(ctx, "files.read", { fileId: id, as: "text", length: 20_000 });
    body = text(r?.text);
  }
  const doc: IndexDoc = {
    entity: "file", id, kind: "file", title: name, body, path, link: `vyre://file/${id}`, label, resource: { type: "file", id }, ...(folderId ? { folderId } : {}),
    ...(typeof f["updatedAt"] === "number" ? { updatedAt: f["updatedAt"] } : {}),
  };
  return { doc };
};

const threadSource: Source = async (ctx, id) => {
  const got = await read<{ thread?: Record<string, unknown> }>(ctx, "threads.get", { threadId: id });
  const t = got?.thread;
  if (!t) return gone;
  const kind = text(t["kind"]);
  // a private chat and an Ask pane are end-to-end (enc = 2): their text is not the server's to index
  if (kind === "chat" || kind === "ask") return e2e;
  if (kind !== "channel" && kind !== "thread") return gone;
  const m = await read<{ messages?: Array<Record<string, unknown>> }>(ctx, "chat.messages.list", { threadId: id, limit: 200 });
  const body = (m?.messages ?? []).filter((x) => num(x["enc"]) !== 2).map((x) => text(x["body"])).filter((s) => s.length > 0).join("\n");
  const title = text(t["title"]) || body.split("\n")[0]?.slice(0, 120) || id;
  const doc: IndexDoc = {
    entity: "thread", id, kind: "chat", title, body, link: `vyre://thread/${id}`, label: 0, resource: { type: "thread", id }, ...(text(t["folderId"]) ? { folderId: text(t["folderId"]) } : {}),
    ...(typeof t["createdAt"] === "number" ? { updatedAt: t["createdAt"] } : {}),
  };
  return { doc };
};

const agentSource: Source = async (ctx, id) => {
  const a = (await read<{ agent?: Record<string, unknown> }>(ctx, "agents.get", { agentId: id }))?.agent;
  if (!a) return gone;
  const doc: IndexDoc = { entity: "agent", id, kind: "agent", title: text(a["name"]) || id, body: text(a["role"]), link: `vyre://agent/${id}`, label: 0, resource: { type: "agent", id }, ...(typeof a["lastActiveAt"] === "number" ? { updatedAt: a["lastActiveAt"] } : {}) };
  return { doc };
};

const automationSource: Source = async (ctx, id) => {
  const a = (await read<{ automation?: Record<string, unknown> }>(ctx, "automations.get", { automationId: id }))?.automation;
  if (!a) return gone;
  const doc: IndexDoc = { entity: "automation", id, kind: "automation", title: text(a["name"]) || id, body: text(a["description"]), link: `vyre://automation/${id}`, label: 0, resource: { type: "automation", id }, ...(typeof a["updatedAt"] === "number" ? { updatedAt: a["updatedAt"] } : {}) };
  return { doc };
};

const taskSource: Source = async (ctx, id) => {
  const t = (await read<{ task?: Record<string, unknown> }>(ctx, "tasks.get", { taskId: id }))?.task;
  if (!t) return gone;
  const doc: IndexDoc = { entity: "task", id, kind: "task", title: text(t["title"]) || id, body: [text(t["summary"]), text(t["why"])].filter(Boolean).join("\n"), link: `vyre://task/${id}`, label: 0, resource: { type: "task", id }, ...(typeof t["updatedAt"] === "number" ? { updatedAt: t["updatedAt"] } : {}) };
  return { doc };
};

const channelSource: Source = async (ctx, id) => {
  const c = (await read<{ channel?: Record<string, unknown> }>(ctx, "channels.get", { channelId: id }))?.channel;
  if (!c || c["archived"] === true) return gone;
  const doc: IndexDoc = { entity: "channel", id, kind: "channel", title: text(c["name"]) || id, body: text(c["topic"]), link: `vyre://channel/${id}`, label: 0, resource: { type: "channel", id }, ...(typeof c["createdAt"] === "number" ? { updatedAt: c["createdAt"] } : {}) };
  return { doc };
};

/** The sources the module brings. People, the inbox, space-layer memory, settings and apps are given by the host through `setSource`. */
export const DEFAULT_SOURCES: Readonly<Record<string, Source>> = {
  record: recordSource, file: fileSource, thread: threadSource, agent: agentSource, automation: automationSource, task: taskSource, channel: channelSource,
};

/** `record:client` is the base `record` with the record type `client` as its sub. */
export function splitEntity(entity: string): { base: string; sub: string | undefined } {
  const i = entity.indexOf(":");
  return i < 0 ? { base: entity, sub: undefined } : { base: entity.slice(0, i), sub: entity.slice(i + 1) || undefined };
}

export const resolve = async (ctx: SearchCtx, entity: string, id: string): Promise<Resolved | null> => {
  const { base, sub } = splitEntity(entity);
  const s = sourceFor(base) ?? DEFAULT_SOURCES[base];
  return s ? s(ctx, id, sub) : null;
};

// ---- search.index.apply

const seenOf = (ctx: SearchCtx, entity: string, id: string): number | null => {
  const r = rowsOf(ctx.db, "SELECT seq FROM search_seen WHERE entity = ? AND id = ?", entity, id)[0];
  return r ? num(r["seq"]) : null;
};
const setSeen = (ctx: SearchCtx, entity: string, id: string, seq: number): void => {
  ctx.db.run("INSERT INTO search_seen (entity, id, seq) VALUES (?, ?, ?) ON CONFLICT (entity, id) DO UPDATE SET seq = excluded.seq", entity, id, seq);
};

/** Apply one changed entity row. Safe to repeat and to receive late: a sequence at or below the last one applied for the row changes nothing. */
export async function indexApply(ctx: SearchCtx, input: { entity: string; id: string; op: "upsert" | "delete"; seq: number }): Promise<{ indexed: boolean }> {
  ensure(ctx.db);
  const { entity, id, op, seq } = input;
  const seen = seenOf(ctx, entity, id);
  if (seen !== null && seq <= seen) return { indexed: false };
  if (op === "delete") {
    const had = removeDoc(ctx.db, ctx.space, entity, id);
    setSeen(ctx, entity, id, seq);
    ctx.db.run("DELETE FROM search_failed WHERE entity = ? AND id = ?", entity, id);
    return { indexed: had };
  }
  let r: Resolved | null;
  try {
    r = await resolve(ctx, entity, id);
  } catch (e) {
    ctx.db.run(
      "INSERT INTO search_failed (entity, id, seq, error, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (entity, id) DO UPDATE SET seq = excluded.seq, error = excluded.error, at = excluded.at",
      entity, id, seq, (e instanceof Error ? e.message : codeOf(e) || "read failed").slice(0, 300), ctx.now(),
    );
    throw e;
  }
  // an entity nobody here knows how to read: nothing to do, and no sequence is recorded, so a source added later can still index it
  if (r === null) return { indexed: false };
  ctx.db.run("DELETE FROM search_failed WHERE entity = ? AND id = ?", entity, id);
  setSeen(ctx, entity, id, seq);
  if ("skip" in r) {
    removeDoc(ctx.db, ctx.space, entity, id);
    return { indexed: false };
  }
  if (r.doc.entity !== entity) r.doc.entity = entity;
  putDoc(ctx.db, ctx.space, r.doc, ctx.now());
  return { indexed: true };
}

// ---- search.embed.run

const EMBED_CHARS = 2_000;

export async function embedRun(ctx: SearchCtx, input: { limit?: number }): Promise<{ embedded: number; pending: number }> {
  ensure(ctx.db);
  const limit = input.limit ?? 100;
  const batch = rowsOf(ctx.db, "SELECT n, title, body FROM search_docs WHERE embedded = 0 ORDER BY n DESC LIMIT ?", limit);
  if (batch.length > 0) {
    const vecs = await embed(batch.map((r) => `${str(r["title"])}\n${str(r["body"]).slice(0, EMBED_CHARS)}`));
    for (let i = 0; i < batch.length; i++) {
      const n = num(batch[i]!["n"]);
      writeVector(ctx.db, ctx.space, n, vecs[i]!);
      ctx.db.run("UPDATE search_docs SET embedded = 1 WHERE n = ?", n);
    }
  }
  return { embedded: batch.length, pending: num(rowsOf(ctx.db, "SELECT count(*) AS c FROM search_docs WHERE embedded = 0")[0]?.["c"]) };
}

// ---- search.index.rebuild

/** Lists the ids of an entity for a rebuild. The module brings listers for what it can enumerate itself; the host gives the rest through `setLister`. */
export type Lister = (ctx: SearchCtx) => Promise<string[]>;
const listers = new Map<string, Lister>();
export function setLister(base: string, l: Lister | null): void { if (l) listers.set(base, l); else listers.delete(base); }

async function pages(ctx: SearchCtx, cap: string, input: Record<string, unknown>, key: string, idKey: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const r = rec(await ctx.call(cap, { ...input, limit: 200, ...(cursor ? { cursor } : {}) }));
    const rows = Array.isArray(r[key]) ? (r[key] as unknown[]) : [];
    for (const x of rows) { const v = text(rec(x)[idKey]); if (v) out.push(v); }
    cursor = typeof r["next"] === "string" ? (r["next"] as string) : undefined;
    if (!cursor) break;
  }
  return out;
}

const DEFAULT_LISTERS: Readonly<Record<string, Lister>> = {
  agent: (ctx) => pages(ctx, "agents.list", {}, "agents", "agentId"),
  automation: (ctx) => pages(ctx, "automations.list", {}, "automations", "id"),
  channel: (ctx) => pages(ctx, "channels.list", {}, "channels", "channelId"),
  task: (ctx) => pages(ctx, "tasks.list", { scope: "all" }, "tasks", "id"),
  thread: async (ctx) => [...(await pages(ctx, "threads.list", { kind: ["channel"] }, "threads", "threadId")), ...(await pages(ctx, "threads.list", { kind: ["thread"] }, "threads", "threadId"))],
};

export async function indexRebuild(ctx: SearchCtx, input: { entity?: string }): Promise<{ runId: string }> {
  ensure(ctx.db);
  const runId = ctx.run ?? mintId("run", ctx.now());
  const wanted = input.entity;
  const inScope = (entity: string): boolean => wanted === undefined || entity === wanted || splitEntity(entity).base === wanted;
  // what the index already holds, then what the sources can list
  const targets = new Map<string, { entity: string; id: string }>();
  for (const r of rowsOf(ctx.db, "SELECT entity, id FROM search_docs")) if (inScope(str(r["entity"]))) targets.set(`${str(r["entity"])}\u0000${str(r["id"])}`, { entity: str(r["entity"]), id: str(r["id"]) });
  for (const r of rowsOf(ctx.db, "SELECT entity, id FROM search_failed")) if (inScope(str(r["entity"]))) targets.set(`${str(r["entity"])}\u0000${str(r["id"])}`, { entity: str(r["entity"]), id: str(r["id"]) });
  for (const base of new Set([...Object.keys(DEFAULT_LISTERS), ...listers.keys()])) {
    if (!inScope(base)) continue;
    const list = listers.get(base) ?? DEFAULT_LISTERS[base];
    if (!list) continue;
    try {
      for (const id of await list(ctx)) targets.set(`${base}\u0000${id}`, { entity: base, id });
    } catch (e) {
      // one module that cannot list must not stop the rest; what it held stays as it was and the failure is in the log
      ctx.log.warn("search rebuild could not list an entity", { entity: base, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const failures: string[] = [];
  for (const t of targets.values()) {
    try {
      const r = await resolve(ctx, t.entity, t.id);
      if (r === null) continue;
      if ("skip" in r) removeDoc(ctx.db, ctx.space, t.entity, t.id);
      else { r.doc.entity = t.entity; putDoc(ctx.db, ctx.space, r.doc, ctx.now()); }
      ctx.db.run("DELETE FROM search_failed WHERE entity = ? AND id = ?", t.entity, t.id);
    } catch (e) {
      failures.push(`${t.entity}:${t.id}`);
      ctx.log.warn("search rebuild could not read a row", { entity: t.entity, id: t.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const documents = num(rowsOf(ctx.db, "SELECT count(*) AS c FROM search_docs")[0]?.["c"]);
  ctx.db.run("INSERT INTO search_meta (k, v) VALUES ('last_rebuild_at', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", String(ctx.now()));
  ctx.db.run("INSERT INTO search_fts (search_fts) VALUES ('optimize')");
  ctx.emit("search.reindexed", runId, { ...(wanted !== undefined ? { entity: wanted } : {}), documents, runId });
  if (failures.length > 0) ctx.log.warn("search rebuild finished with unread rows", { count: failures.length });
  return { runId };
}

// ---- search.index.stats and search.health

export async function indexStats(ctx: SearchCtx): Promise<{ documents: number; vectors: number; ftsLagSeq: number; vectorBacklog: number; lastRebuildAt?: number }> {
  ensure(ctx.db);
  const c = (sql: string): number => num(rowsOf(ctx.db, sql)[0]?.["c"]);
  const last = rowsOf(ctx.db, "SELECT v FROM search_meta WHERE k = 'last_rebuild_at'")[0];
  return {
    documents: c("SELECT count(*) AS c FROM search_docs"),
    vectors: c("SELECT count(*) AS c FROM search_vectors"),
    // rows the indexer could not read yet are the lag: each is waiting for a retry
    ftsLagSeq: c("SELECT count(*) AS c FROM search_failed"),
    vectorBacklog: c("SELECT count(*) AS c FROM search_docs WHERE embedded = 0"),
    ...(last ? { lastRebuildAt: num(last["v"]) } : {}),
  };
}

const SLOW_MS = 300;

export async function health(ctx: SearchCtx): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
  const t0 = performance.now();
  try {
    ensure(ctx.db);
    rowsOf(ctx.db, "SELECT rowid FROM search_fts WHERE search_fts MATCH ? ORDER BY rowid DESC LIMIT 1", '"health"*');
    vectorsOf(ctx.db, ctx.space);
  } catch (e) {
    return { state: "down", detail: `The index cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  const latencyMs = Math.max(0, Math.round(performance.now() - t0));
  const s = await indexStats(ctx);
  if (s.ftsLagSeq > 0) return { state: "degraded", detail: `${s.ftsLagSeq} rows could not be read and wait for a retry`, latencyMs };
  if (latencyMs > SLOW_MS) return { state: "degraded", detail: `A probe query took ${latencyMs} ms (the budget is ${SLOW_MS} ms)`, latencyMs };
  if (s.vectorBacklog > 1000) return { state: "degraded", detail: `${s.vectorBacklog} documents wait for their vectors`, latencyMs };
  return { state: "healthy", latencyMs };
}

// ---- search.recent.record

export async function recentRecord(ctx: SearchCtx, input: { kind: string; itemId: string }): Promise<{ ok: boolean }> {
  ensure(ctx.db);
  ctx.db.run(
    "INSERT INTO search_recent (principal, kind, item_id, at) VALUES (?, ?, ?, ?) ON CONFLICT (principal, kind, item_id) DO UPDATE SET at = excluded.at",
    askerOf(ctx), input.kind, input.itemId, ctx.now(),
  );
  // keep each person's list short: the newest 200
  ctx.db.run(
    "DELETE FROM search_recent WHERE principal = ? AND at < COALESCE((SELECT at FROM search_recent WHERE principal = ? ORDER BY at DESC LIMIT 1 OFFSET 199), 0)",
    askerOf(ctx), askerOf(ctx),
  );
  return { ok: true };
}

export const handlers = {
  "search.query": query,
  "search.recent.list": recentList,
  "search.recent.record": recentRecord,
  "search.actions.list": actionsList,
  "search.related": related,
  "search.index.apply": indexApply,
  "search.embed.run": embedRun,
  "search.index.rebuild": indexRebuild,
  "search.index.stats": indexStats,
  "search.health": health,
};

