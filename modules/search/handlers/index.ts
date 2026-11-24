// The index side of the search module (spec b11; ARCH 4.3 consumers search.fts and search.vectors): the sources that turn an entity row into a document, search.index.apply, the embeddings
// consumer, the rebuild, the stats and the health probe, and the two small writes Recent needs. The handler table at the bottom holds all ten capabilities of manifests/search.ts.
// Private content never reaches the index: a source answers `e2e` (the name of the row's encryption label, not a claim about the chat) for a private chat, a Restricted row or a sealed message, and apply then removes whatever was there.
import { turns } from "../../../lib/yield-loop.ts";
import { isRawId } from "../../../lib/id-shapes.ts";
import {
  askerOf,
  embed,
  ensure,
  mintId,
  num,
  putDoc,
  removeDoc,
  rowsOf,
  str,
  vectorsOf,
  writeVectors,
  sourceFor,
} from "../projections.ts";
import type { IndexDoc, Resolved, SearchCtx, Source } from "../projections.ts";
import { ask } from "./ask.ts";
import { actionsList, query, recentList, related, resolveItem } from "./query.ts";

const NOT_FOUND = new Set(["validation.not_found", "permission.not_found"]);
const codeOf = (e: unknown): string =>
  (e as { error?: { code?: string }; code?: string } | null)?.error?.code ??
  (e as { code?: string } | null)?.code ??
  "";

/**
 * What the service could not open, and when it asked (F52). A person's private chat or private agent is refused to the Space's own service, which is how the index stays free of it; asking again on every
 * event of that chat is a refusal on every turn. The answer stands for PRIVATE_FOR_MS, after which one more ask settles whether it is still unreadable (a row that was only late becomes visible then).
 */
export const PRIVATE_FOR_MS = 10 * 60_000;
// keyed by Space: the handle a host gives each call may be a new object every time
const unreadable = new Map<string, Map<string, number>>();
const WATCH_PRIVATE = new Set(["thread", "chat", "agent"]);

/** An event says the thing is private (a chat or Ask pane starting, a private agent being made): it is never asked about, for as long as the server runs. */
export function notePrivate(space: string, e: { type: string; payload: Record<string, unknown> }): void {
  if (e.type === "agent.privacy_set" && typeof e.payload["agentId"] === "string") {
    const m = unreadable.get(space) ?? unreadable.set(space, new Map()).get(space)!;
    const k = `agent\u0000${e.payload["agentId"]}`;
    if (e.payload["private"] === true) m.set(k, Infinity);
    else m.delete(k);
    return;
  }
  const entity =
    e.type === "thread.started" && (e.payload["kind"] === "chat" || e.payload["kind"] === "ask")
      ? "thread"
      : e.type === "agent.created" && e.payload["private"] === true
        ? "agent"
        : "";
  const id = e.payload[entity === "thread" ? "threadId" : "agentId"];
  if (entity === "" || typeof id !== "string") return;
  (unreadable.get(space) ?? unreadable.set(space, new Map()).get(space)!).set(`${entity}\u0000${id}`, Infinity);
}

/** Read through a capability; a missing or hidden row is `null`, any other failure is the caller's to handle. */
async function read<T>(ctx: SearchCtx, cap: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    return (await ctx.call(cap, input)) as T;
  } catch (e) {
    if (NOT_FOUND.has(codeOf(e))) return null;
    throw e;
  }
}

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const gone: Resolved = { skip: "gone" };
const e2e: Resolved = { skip: "e2e" };
const SECRET = /pass(word|phrase)?|secret|token|api.?key|credential/i;

/** The words of a record's fields: strings, numbers and lists of strings; nothing that looks like a credential, and no id (a field that holds a person, a folder or another record holds its id, which is no word of the record and is shown to a person as its snippet). */
function fieldWords(fields: Record<string, unknown>, skip: string): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === skip || SECRET.test(k)) continue;
    if (typeof v === "string") {
      if (!isRawId(v)) out.push(v);
    } else if (typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && !isRawId(x)) out.push(x);
  }
  return out.join(" ");
}

const labelOf = (v: unknown): number => Math.max(0, Math.min(3, Math.trunc(num(v))));

// A record type's title field, asked of the schema once in a while and not for each record: schema.types.get returns the whole type (578 fields of a firm's matter), and a bulk write of ten thousand records
// asked it ten thousand times (a third of the time the full-text consumer spent on a record). A change of the title field reaches the documents indexed after this window; one reindex puts the rest right.
const TITLE_FIELD_TTL_MS = 10_000;
const titleFields = new Map<string, { at: number; field: string }>();
/** The cached title field of a type is forgotten (its schema changed). */
export function dropTitleField(space: string, type: string): void {
  titleFields.delete(`${space}\u0000${type}`);
}

async function titleFieldOf(ctx: SearchCtx, type: string): Promise<string> {
  const key = `${ctx.space}\u0000${type}`;
  const have = titleFields.get(key);
  const now = ctx.now();
  if (have && now >= have.at && now - have.at < TITLE_FIELD_TTL_MS) return have.field;
  const t = await read<{ type?: Record<string, unknown> }>(ctx, "schema.types.get", { type });
  const field = text(t?.type?.["titleField"]);
  if (t) {
    titleFields.set(key, { at: now, field });
    // what the documents of this type were titled by: noted once, at the first one; a change of the title field moves it only when the documents have been titled again (retitleRun)
    ctx.db.run("INSERT OR IGNORE INTO search_meta (k, v) VALUES (?, ?)", `tf:${type}`, field);
  }
  return field;
}

/**
 * A type's schema changed: when its title field is no longer the one its documents were titled by, the type's documents are marked to be titled again, a page at a time by `search.retitle` (retitleRun).
 * Without it a renamed title field left every old record under its old title until the record itself changed.
 */
export async function noteTitleChange(ctx: SearchCtx, types: readonly string[], seq: number): Promise<number> {
  ensure(ctx.db);
  let marked = 0;
  for (const type of types) {
    dropTitleField(ctx.space, type);
    const fresh = await titleFieldOf(ctx, type);
    const was = rowsOf(ctx.db, "SELECT v FROM search_meta WHERE k = ?", `tf:${type}`)[0]?.["v"];
    if (was === undefined) continue;
    if (str(was) === fresh) {
      // the title field went back to the one the documents were titled by: a pending re-titling towards the other one is started again towards this one (the pages it had done are titled by the other)
      const pending = rowsOf(ctx.db, "SELECT v FROM search_meta WHERE k = ?", `retitle:${type}`)[0]?.["v"];
      if (pending !== undefined)
        ctx.db.run(
          "UPDATE search_meta SET v = ? WHERE k = ?",
          JSON.stringify({ to: fresh, after: "", seq }),
          `retitle:${type}`,
        );
      continue;
    }
    ctx.db.run(
      "INSERT INTO search_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
      `retitle:${type}`,
      JSON.stringify({ to: fresh, after: "", seq }),
    );
    marked++;
  }
  return marked;
}

/**
 * The first start after the update that brought re-titling: documents indexed before it have no recorded title field, so a title field that changed earlier is in none of them. Every record type that has
 * documents is queued once for the same paged re-titling (which then records the field for all); `retitled_all` says it was done.
 */
export function queueAllRetitles(ctx: SearchCtx): number {
  ensure(ctx.db);
  if (rowsOf(ctx.db, "SELECT v FROM search_meta WHERE k = 'retitled_all'").length > 0) return 0;
  let n = 0;
  for (const r of rowsOf(ctx.db, "SELECT DISTINCT record_type AS t FROM search_docs WHERE record_type IS NOT NULL")) {
    ctx.db.run(
      "INSERT OR IGNORE INTO search_meta (k, v) VALUES (?, ?)",
      `retitle:${str(r["t"])}`,
      JSON.stringify({ to: "", after: "", seq: 0 }),
    );
    n++;
  }
  ctx.db.run("INSERT OR IGNORE INTO search_meta (k, v) VALUES ('retitled_all', '1')");
  return n;
}

const RETITLE_PAGE = 100;
/** One page of each pending re-titling: the documents of the type are read again (indexApply, as for any change) from where the last page stopped. Returns how many documents it did. */
export async function retitleRun(ctx: SearchCtx): Promise<number> {
  ensure(ctx.db);
  queueAllRetitles(ctx);
  let done = 0;
  for (const m of rowsOf(ctx.db, "SELECT k, v FROM search_meta WHERE k LIKE 'retitle:%'")) {
    const type = str(m["k"]).slice("retitle:".length);
    let p: { to: string; after: string | number; seq: number };
    try {
      p = JSON.parse(str(m["v"])) as typeof p;
    } catch {
      ctx.db.run("DELETE FROM search_meta WHERE k = ?", str(m["k"]));
      continue;
    }
    // where the last page stopped: "entity\u0000id" (an older build kept a number or an id alone: those start over)
    const [afterEntity, afterId] =
      typeof p.after === "string" && p.after.includes("\u0000") ? p.after.split("\u0000") : ["", ""];
    const docs = rowsOf(
      ctx.db,
      "SELECT n, entity, id FROM search_docs WHERE record_type = ? AND (entity > ? OR (entity = ? AND id > ?)) ORDER BY entity, id LIMIT ?",
      type,
      // by (entity, id), not by n: a document put in again gets a new n, and a page by n would meet it again and again; the key is the table's own, so two documents that share an id under different
      // entities are never split by a page boundary
      afterEntity,
      afterEntity,
      afterId,
      RETITLE_PAGE,
    );
    const turn = turns(15);
    for (const d of docs) {
      await turn();
      try {
        const entity = str(d["entity"]),
          id = str(d["id"]);
        await indexApply(ctx, { entity, id, op: "upsert", seq: seenOf(ctx, entity, id) ?? p.seq, force: true });
      } catch {
        /* the next change of the record reads it again; one record never holds the page */
      }
      done++;
    }
    if (docs.length < RETITLE_PAGE) {
      // queued by the first start after the update, the field is not known yet: it is read now, and recorded for the type's documents
      const to = p.to === "" ? await titleFieldOf(ctx, type) : p.to;
      ctx.db.run(
        "INSERT INTO search_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
        `tf:${type}`,
        to,
      );
      // the title field may have moved again while the pages ran (A to B to A): what it is now is read fresh, and a different one starts the type over
      dropTitleField(ctx.space, type);
      const now = await titleFieldOf(ctx, type);
      if (now !== "" && now !== to) {
        ctx.db.run(
          "UPDATE search_meta SET v = ? WHERE k = ?",
          JSON.stringify({ to: now, after: "", seq: p.seq }),
          str(m["k"]),
        );
        continue;
      }
      ctx.db.run("DELETE FROM search_meta WHERE k = ?", str(m["k"]));
    } else {
      p.after = `${str(docs[docs.length - 1]!["entity"])}\u0000${str(docs[docs.length - 1]!["id"])}`;
      ctx.db.run("UPDATE search_meta SET v = ? WHERE k = ?", JSON.stringify(p), str(m["k"]));
    }
  }
  return done;
}

const recordSource: Source = async (ctx, id, sub) => {
  const got = await read<{ record?: Record<string, unknown> }>(ctx, "records.get", {
    recordId: id,
    ...(sub ? { type: sub } : {}),
  });
  const r = got?.record;
  if (!r || r["deletedAt"] !== undefined) return gone;
  const label = labelOf(r["label"]);
  if (label >= 3) return e2e;
  const type = text(r["type"]) || sub || "";
  const fields = rec(r["fields"]);
  let titleField = "";
  if (type) titleField = await titleFieldOf(ctx, type);
  const first = Object.entries(fields).find(([, v]) => typeof v === "string" && v.length > 0);
  const title = (
    titleField && typeof fields[titleField] === "string"
      ? (fields[titleField] as string)
      : first
        ? (first[1] as string)
        : id
  ).slice(0, 300);
  const doc: IndexDoc = {
    entity: sub ? `record:${sub}` : "record",
    id,
    kind: "record",
    title,
    body: fieldWords(fields, titleField),
    link: `vyre://record/${id}`,
    label,
    resource: { type: "record", id },
    ...(type ? { recordType: type } : {}),
    ...(typeof r["updatedAt"] === "number" ? { updatedAt: r["updatedAt"] } : {}),
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
  const textual = TEXTUAL.has(text(f["kind"]));
  let body = "";
  if (textual) {
    const r = await read<{ text?: string }>(ctx, "files.read", { fileId: id, as: "text", length: 20_000 });
    body = text(r?.text);
  }
  // Redaction for AI: a person's search keeps the whole text (a person who may read the file finds a redacted word in it). When an agent may read less, the agent's view is kept beside it, and an
  // agent's search matches and quotes only that: [REDACTED] where a part is hidden, no body while the file waits for review, nothing at all while agents may not see it or the view is not there.
  type View = { state?: string; name?: string; path?: string; text?: string | null };
  let v: View | null;
  try {
    v = await read<View>(ctx, "files.agent_view", { fileId: id });
  } catch {
    v = null;
  } // fail closed: no view, nothing for an agent; a person's search is untouched
  const agentTitle = text(v?.name) || name;
  const agentFolder = text(v?.path);
  const agentPath = agentFolder ? `${agentFolder.replace(/\/$/, "")}/${agentTitle}` : agentTitle;
  const agentBody = textual ? text(v?.text).slice(0, 20_000) : "";
  const differs = !v || (v.state ?? "clear") !== "clear" || agentTitle !== name || agentBody !== body.slice(0, 20_000);
  const doc: IndexDoc = {
    entity: "file",
    id,
    kind: "file",
    title: name,
    body,
    path,
    link: `vyre://file/${id}`,
    label,
    resource: { type: "file", id },
    ...(folderId ? { folderId } : {}),
    ...(typeof f["updatedAt"] === "number" ? { updatedAt: f["updatedAt"] } : {}),
    ...(differs
      ? { agent: { title: agentTitle, path: agentPath, body: v ? agentBody : "", withheld: !v || v.state === "off" } }
      : {}),
  };
  return { doc };
};

const threadSource: Source = async (ctx, id) => {
  const got = await read<{ thread?: Record<string, unknown> }>(ctx, "threads.get", { threadId: id });
  const t = got?.thread;
  if (!t) return gone;
  const kind = text(t["kind"]);
  // a private chat and an Ask pane (enc = 2) are nobody else's to search, so their text is not indexed
  if (kind === "chat" || kind === "ask") return e2e;
  if (kind !== "channel" && kind !== "thread") return gone;
  const m = await read<{ messages?: Array<Record<string, unknown>> }>(ctx, "chat.messages.list", {
    threadId: id,
    limit: 200,
  });
  const body = (m?.messages ?? [])
    .filter((x) => num(x["enc"]) !== 2)
    .map((x) => text(x["body"]))
    .filter((s) => s.length > 0)
    .join("\n");
  const title = text(t["title"]) || body.split("\n")[0]?.slice(0, 120) || id;
  const doc: IndexDoc = {
    entity: "thread",
    id,
    kind: "chat",
    title,
    body,
    link: `vyre://thread/${id}`,
    label: 0,
    resource: { type: "thread", id },
    ...(text(t["folderId"]) ? { folderId: text(t["folderId"]) } : {}),
    ...(typeof t["createdAt"] === "number" ? { updatedAt: t["createdAt"] } : {}),
  };
  return { doc };
};

const agentSource: Source = async (ctx, id) => {
  const a = (await read<{ agent?: Record<string, unknown> }>(ctx, "agents.get", { agentId: id }))?.agent;
  if (!a) return gone;
  // a private agent (a person's assistant, an outside agent connected through /mcp) is its person's alone: the shared index never holds it, so no one else finds it in search
  if (a["kind"] === "assistant" || a["runtime"] === "outside") return gone;
  const doc: IndexDoc = {
    entity: "agent",
    id,
    kind: "agent",
    title: text(a["name"]) || id,
    body: text(a["role"]),
    link: `vyre://agent/${id}`,
    label: 0,
    resource: { type: "agent", id },
    ...(typeof a["lastActiveAt"] === "number" ? { updatedAt: a["lastActiveAt"] } : {}),
  };
  return { doc };
};

const automationSource: Source = async (ctx, id) => {
  const a = (await read<{ automation?: Record<string, unknown> }>(ctx, "automations.get", { automationId: id }))
    ?.automation;
  if (!a) return gone;
  const doc: IndexDoc = {
    entity: "automation",
    id,
    kind: "automation",
    title: text(a["name"]) || id,
    body: text(a["description"]),
    link: `vyre://automation/${id}`,
    label: 0,
    resource: { type: "automation", id },
    ...(typeof a["updatedAt"] === "number" ? { updatedAt: a["updatedAt"] } : {}),
  };
  return { doc };
};

const taskSource: Source = async (ctx, id) => {
  const t = (await read<{ task?: Record<string, unknown> }>(ctx, "tasks.get", { taskId: id }))?.task;
  if (!t) return gone;
  const doc: IndexDoc = {
    entity: "task",
    id,
    kind: "task",
    title: text(t["title"]) || id,
    body: [text(t["summary"]), text(t["why"])].filter(Boolean).join("\n"),
    link: `vyre://task/${id}`,
    label: 0,
    resource: { type: "task", id },
    ...(typeof t["updatedAt"] === "number" ? { updatedAt: t["updatedAt"] } : {}),
  };
  return { doc };
};

const channelSource: Source = async (ctx, id) => {
  const c = (await read<{ channel?: Record<string, unknown> }>(ctx, "channels.get", { channelId: id }))?.channel;
  if (!c || c["archived"] === true) return gone;
  const doc: IndexDoc = {
    entity: "channel",
    id,
    kind: "channel",
    title: text(c["name"]) || id,
    body: text(c["topic"]),
    link: `vyre://channel/${id}`,
    label: 0,
    resource: { type: "channel", id },
    ...(typeof c["createdAt"] === "number" ? { updatedAt: c["createdAt"] } : {}),
  };
  return { doc };
};

/** The sources the module brings. People, the inbox, space-layer memory, settings and apps are given by the host through `setSource`. */
export const DEFAULT_SOURCES: Readonly<Record<string, Source>> = {
  record: recordSource,
  file: fileSource,
  thread: threadSource,
  agent: agentSource,
  automation: automationSource,
  task: taskSource,
  channel: channelSource,
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
  ctx.db.run(
    "INSERT INTO search_seen (entity, id, seq) VALUES (?, ?, ?) ON CONFLICT (entity, id) DO UPDATE SET seq = excluded.seq",
    entity,
    id,
    seq,
  );
};

/** Apply one changed entity row. Safe to repeat and to receive late: a sequence at or below the last one applied for the row changes nothing. */
/**
 * A folder that goes to Trash takes its files out of the index with it (F62, 14 Nov 2026): the files are not events of their own, so without this a deleted artifact's page stayed findable to whoever it was shared with.
 * The files of the folder itself, and those below it (found by the folder's path, taken from one of its own files), leave.
 */
export function indexDropFolder(ctx: SearchCtx, folderId: string, seq: number): number {
  ensure(ctx.db);
  const direct = ctx.db.all(
    "SELECT entity, id, path FROM search_docs WHERE folder_id = ? AND res_type = 'file'",
    folderId,
  ) as {
    entity: string;
    id: string;
    path: string | null;
  }[];
  const base = direct.map((r) => String(r.path ?? "")).find((p) => p.includes("/"));
  const prefix = base === undefined ? null : base.slice(0, base.lastIndexOf("/") + 1);
  const below =
    prefix === null
      ? []
      : (ctx.db.all(
          "SELECT entity, id FROM search_docs WHERE res_type = 'file' AND path LIKE ? ESCAPE '\\'",
          `${prefix.replace(/[\\%_]/g, "\\$&")}%`,
        ) as {
          entity: string;
          id: string;
        }[]);
  let n = 0;
  for (const r of [...direct, ...below]) {
    if (removeDoc(ctx.db, ctx.space, r.entity, r.id)) n++;
    setSeen(ctx, r.entity, r.id, seq);
  }
  return n;
}

export async function indexApply(
  ctx: SearchCtx,
  input: { entity: string; id: string; op: "upsert" | "delete"; seq: number; force?: boolean },
): Promise<{ indexed: boolean }> {
  ensure(ctx.db);
  const { entity, id, op, seq } = input;
  const seen = seenOf(ctx, entity, id);
  // `force` reads the row again whatever it was last indexed at (a re-titling): the caller passes the row's own sequence, so what is recorded does not move
  if (input.force !== true && seen !== null && seq <= seen) return { indexed: false };
  if (op === "delete") {
    unreadable.get(ctx.space)?.delete(`${entity}\u0000${id}`);
    const had = removeDoc(ctx.db, ctx.space, entity, id);
    setSeen(ctx, entity, id, seq);
    ctx.db.run("DELETE FROM search_failed WHERE entity = ? AND id = ?", entity, id);
    return { indexed: had };
  }
  // A person's own agents that nobody shared are theirs alone (owner ruling 4 Nov; agents canSee): the kernel denies the service the view, and agents.get would refuse it, so the service does not ask and remembers
  // nothing: the next change of the agent after it is shared reads it. (Found by F52: the walk's one late refusal was this, for an ordinary agent.)
  if (entity === "agent" && ctx.authorize({ perm: null, level: "view" }, { type: "agent", id }).effect !== "allow") {
    removeDoc(ctx.db, ctx.space, entity, id);
    setSeen(ctx, entity, id, seq);
    return { indexed: false };
  }
  const memo = unreadable.get(ctx.space) ?? unreadable.set(ctx.space, new Map()).get(ctx.space)!;
  const key = `${entity}\u0000${id}`;
  if (WATCH_PRIVATE.has(entity) && (memo.get(key) ?? 0) > ctx.now()) {
    removeDoc(ctx.db, ctx.space, entity, id); // it may have been indexed before it turned private
    setSeen(ctx, entity, id, seq);
    return { indexed: false };
  }
  let r: Resolved | null;
  try {
    r = await resolve(ctx, entity, id);
  } catch (e) {
    ctx.db.run(
      "INSERT INTO search_failed (entity, id, seq, error, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (entity, id) DO UPDATE SET seq = excluded.seq, error = excluded.error, at = excluded.at",
      entity,
      id,
      seq,
      (e instanceof Error ? e.message : codeOf(e) || "read failed").slice(0, 300),
      ctx.now(),
    );
    throw e;
  }
  // an entity nobody here knows how to read: nothing to do, and no sequence is recorded, so a source added later can still index it
  if (r === null) return { indexed: false };
  // the writes for the row (the failure mark, the sequence, the old document out, the new one and its text in) are one transaction: they were five or six commits
  const finish = (): { indexed: boolean } => {
    ctx.db.run("DELETE FROM search_failed WHERE entity = ? AND id = ?", entity, id);
    setSeen(ctx, entity, id, seq);
    if ("skip" in r) {
      removeDoc(ctx.db, ctx.space, entity, id);
      if (WATCH_PRIVATE.has(entity)) {
        memo.set(key, ctx.now() + PRIVATE_FOR_MS);
        if (memo.size > 5000) for (const [k, until] of memo) if (until <= ctx.now()) memo.delete(k);
      }
      return { indexed: false };
    }
    if (r.doc.entity !== entity) r.doc.entity = entity;
    putDoc(ctx.db, ctx.space, r.doc, ctx.now());
    return { indexed: true };
  };
  return ctx.db.batch ? ctx.db.batch(finish) : finish();
}

// ---- search.embed.run

const EMBED_CHARS = 2_000;
const EMBED_SLICE = 5;

export async function embedRun(
  ctx: SearchCtx,
  input: { limit?: number },
): Promise<{ embedded: number; pending: number }> {
  ensure(ctx.db);
  const limit = input.limit ?? 100;
  const batch = rowsOf(
    ctx.db,
    "SELECT n, title, body FROM search_docs WHERE embedded = 0 ORDER BY n DESC LIMIT ?",
    limit,
  );
  if (batch.length > 0) {
    // a slice at a time: computing the vectors of a whole batch of documents is one stretch of synchronous work, so the loop is given back between slices
    const turn = turns(5);
    for (let from = 0; from < batch.length; from += EMBED_SLICE) {
      const part = batch.slice(from, from + EMBED_SLICE);
      const vecs = await embed(part.map((r) => `${str(r["title"])}\n${str(r["body"]).slice(0, EMBED_CHARS)}`));
      writeVectors(
        ctx.db,
        ctx.space,
        part.map((r, i) => ({ n: num(r["n"]), v: vecs[i]! })),
      );
      await turn();
    }
  }
  return {
    embedded: batch.length,
    pending: num(rowsOf(ctx.db, "SELECT count(*) AS c FROM search_docs WHERE embedded = 0")[0]?.["c"]),
  };
}

// ---- search.index.rebuild

/** Lists the ids of an entity for a rebuild. The module brings listers for what it can enumerate itself; the host gives the rest through `setLister`. */
export type Lister = (ctx: SearchCtx) => Promise<string[]>;
const listers = new Map<string, Lister>();
export function setLister(base: string, l: Lister | null): void {
  if (l) listers.set(base, l);
  else listers.delete(base);
}

async function pages(
  ctx: SearchCtx,
  cap: string,
  input: Record<string, unknown>,
  key: string,
  idKey: string,
): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const r = rec(await ctx.call(cap, { ...input, limit: 200, ...(cursor ? { cursor } : {}) }));
    const rows = Array.isArray(r[key]) ? (r[key] as unknown[]) : [];
    for (const x of rows) {
      const v = text(rec(x)[idKey]);
      if (v) out.push(v);
    }
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
  thread: async (ctx) => [
    ...(await pages(ctx, "threads.list", { kind: ["channel"] }, "threads", "threadId")),
    ...(await pages(ctx, "threads.list", { kind: ["thread"] }, "threads", "threadId")),
  ],
};

export async function indexRebuild(ctx: SearchCtx, input: { entity?: string }): Promise<{ runId: string }> {
  ensure(ctx.db);
  const runId = ctx.run ?? mintId("run", ctx.now());
  const wanted = input.entity;
  const inScope = (entity: string): boolean =>
    wanted === undefined || entity === wanted || splitEntity(entity).base === wanted;
  // what the index already holds, then what the sources can list
  const targets = new Map<string, { entity: string; id: string }>();
  for (const r of rowsOf(ctx.db, "SELECT entity, id FROM search_docs"))
    if (inScope(str(r["entity"])))
      targets.set(`${str(r["entity"])}\u0000${str(r["id"])}`, { entity: str(r["entity"]), id: str(r["id"]) });
  for (const r of rowsOf(ctx.db, "SELECT entity, id FROM search_failed"))
    if (inScope(str(r["entity"])))
      targets.set(`${str(r["entity"])}\u0000${str(r["id"])}`, { entity: str(r["entity"]), id: str(r["id"]) });
  for (const base of new Set([...Object.keys(DEFAULT_LISTERS), ...listers.keys()])) {
    if (!inScope(base)) continue;
    const list = listers.get(base) ?? DEFAULT_LISTERS[base];
    if (!list) continue;
    try {
      for (const id of await list(ctx)) targets.set(`${base}\u0000${id}`, { entity: base, id });
    } catch (e) {
      // one module that cannot list must not stop the rest; what it held stays as it was and the failure is in the log
      ctx.log.warn("search rebuild could not list an entity", {
        entity: base,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const failures: string[] = [];
  for (const t of targets.values()) {
    try {
      const r = await resolve(ctx, t.entity, t.id);
      if (r === null) continue;
      if ("skip" in r) removeDoc(ctx.db, ctx.space, t.entity, t.id);
      else {
        r.doc.entity = t.entity;
        putDoc(ctx.db, ctx.space, r.doc, ctx.now());
      }
      ctx.db.run("DELETE FROM search_failed WHERE entity = ? AND id = ?", t.entity, t.id);
    } catch (e) {
      failures.push(`${t.entity}:${t.id}`);
      ctx.log.warn("search rebuild could not read a row", {
        entity: t.entity,
        id: t.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const documents = num(rowsOf(ctx.db, "SELECT count(*) AS c FROM search_docs")[0]?.["c"]);
  ctx.db.run(
    "INSERT INTO search_meta (k, v) VALUES ('last_rebuild_at', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
    String(ctx.now()),
  );
  ctx.db.run("INSERT INTO search_fts (search_fts) VALUES ('optimize')");
  ctx.emit("search.reindexed", runId, { ...(wanted !== undefined ? { entity: wanted } : {}), documents, runId });
  if (failures.length > 0) ctx.log.warn("search rebuild finished with unread rows", { count: failures.length });
  return { runId };
}

// ---- search.index.stats and search.health

export async function indexStats(
  ctx: SearchCtx,
): Promise<{ documents: number; vectors: number; ftsLagSeq: number; vectorBacklog: number; lastRebuildAt?: number }> {
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

export async function health(
  ctx: SearchCtx,
): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
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
  if (s.ftsLagSeq > 0)
    return { state: "degraded", detail: `${s.ftsLagSeq} rows could not be read and wait for a retry`, latencyMs };
  if (latencyMs > SLOW_MS)
    return { state: "degraded", detail: `A probe query took ${latencyMs} ms (the budget is ${SLOW_MS} ms)`, latencyMs };
  if (s.vectorBacklog > 1000)
    return { state: "degraded", detail: `${s.vectorBacklog} documents wait for their vectors`, latencyMs };
  return { state: "healthy", latencyMs };
}

// ---- search.recent.record

export async function recentRecord(ctx: SearchCtx, input: { kind: string; itemId: string }): Promise<{ ok: boolean }> {
  ensure(ctx.db);
  ctx.db.run(
    "INSERT INTO search_recent (principal, kind, item_id, at) VALUES (?, ?, ?, ?) ON CONFLICT (principal, kind, item_id) DO UPDATE SET at = excluded.at",
    askerOf(ctx),
    input.kind,
    input.itemId,
    ctx.now(),
  );
  // keep each person's list short: the newest 200
  ctx.db.run(
    "DELETE FROM search_recent WHERE principal = ? AND at < COALESCE((SELECT at FROM search_recent WHERE principal = ? ORDER BY at DESC LIMIT 1 OFFSET 199), 0)",
    askerOf(ctx),
    askerOf(ctx),
  );
  return { ok: true };
}

export const handlers = {
  "search.query": query,
  "search.ask": ask,
  "search.resolve": resolveItem,
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
