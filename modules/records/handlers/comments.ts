// Comments on a record (the right pane's Comments tab): threads a person leaves, replies to, edits, resolves and reopens. A comment is not a chat: it is a short note on the record that everyone who can
// see the record can read.
//   @ a person   they get an Answer request in Needs you that names the record and the comment.
//   @ an agent   the agent answers under the comment, headless. It is started as a private Ask pane on the record (never listed in Recent, so no chat shows up) with the thread as its message, and
//                it replies by calling records.comments.add as itself, so its tools, limits and holds are the Space's. While it works the comment says who is replying; the turn ending clears that.
// An agent's comment never starts another agent (two agents cannot keep each other going); it can still ask a person.
import { mintId } from "../../../lib/ids.ts";
import type { Principal } from "../../../packages/contracts/src/ctx.ts";
import type { EventName, TraceContext } from "../../../packages/contracts/src/types.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { fail } from "./history.ts";

export interface CommentsCtx {
  trace: TraceContext;
  principal: Principal;
  emit: (name: EventName, subject: string, payload: Record<string, unknown>) => unknown;
  call: (cap: never, input: unknown) => Promise<unknown>;
  authorize?: (action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }) => { effect: "allow" | "deny" | "hold"; reason: string };
  now?: () => number;
  log?: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

export interface Mention { kind: "person" | "agent"; id: string }
export interface CommentRow {
  commentId: string; type: string; recordId: string; parentId?: string; text: string; by: string; at: number; editedAt?: number;
  resolved: boolean; resolvedBy?: string; mentions: Mention[]; replying: string[];
}

export interface CommentsDeps { tx: Tx; now?: () => number }

const TABLES = [
  `CREATE TABLE IF NOT EXISTS records_comment (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, record_id TEXT NOT NULL, parent_id TEXT, text TEXT NOT NULL, author TEXT NOT NULL, at INTEGER NOT NULL,
    edited_at INTEGER, resolved INTEGER NOT NULL DEFAULT 0, resolved_by TEXT, mentions TEXT NOT NULL, deleted_at INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS records_comment__record ON records_comment (record_id)",
  `CREATE TABLE IF NOT EXISTS records_comment_agent (
    comment_id TEXT NOT NULL, agent_id TEXT NOT NULL, thread_id TEXT, state TEXT NOT NULL, PRIMARY KEY (comment_id, agent_id)
  )`,
  "CREATE INDEX IF NOT EXISTS records_comment_agent__thread ON records_comment_agent (thread_id)",
];
const ready = new WeakSet<object>();
function ensureTables(tx: Tx): void {
  const key = tx as unknown as object;
  if (ready.has(key)) return;
  for (const sql of TABLES) tx.exec(sql);
  ready.add(key);
}

interface Row { id: string; type: string; record_id: string; parent_id: string | null; text: string; author: string; at: number; edited_at: number | null; resolved: number; resolved_by: string | null; mentions: string; deleted_at: number | null }
const MAX_TEXT = 4000;
const PERSON = /^usr_[A-Za-z0-9_-]+$/;
const AGENT = /^agt_[A-Za-z0-9_-]+$/;

export interface CommentsHandlers {
  "records.comments.list"(ctx: CommentsCtx, input: { type: string; recordId: string; includeResolved?: boolean }): Promise<{ comments: CommentRow[]; resolvedCount: number }>;
  "records.comments.add"(ctx: CommentsCtx, input: { type: string; recordId: string; text: string; parentId?: string; mentions?: Mention[] }): Promise<{ comment: CommentRow }>;
  "records.comments.edit"(ctx: CommentsCtx, input: { commentId: string; text: string }): Promise<{ comment: CommentRow }>;
  "records.comments.resolve"(ctx: CommentsCtx, input: { commentId: string; resolved: boolean }): Promise<{ comment: CommentRow }>;
  "records.comments.delete"(ctx: CommentsCtx, input: { commentId: string }): Promise<{ deleted: boolean }>;
}

/** The agent turns that ended: the comments they were answering stop saying "is replying". */
export function settleTurn(tx: Tx, threadId: string, agentId: string, state: "done" | "failed"): number {
  ensureTables(tx);
  return tx.run("UPDATE records_comment_agent SET state = ? WHERE thread_id = ? AND agent_id = ? AND state = 'pending'", state, threadId, agentId).changes;
}

export function createCommentsHandlers(deps: CommentsDeps): CommentsHandlers {
  const { tx } = deps;
  const now = (ctx: CommentsCtx): number => ctx.now?.() ?? deps.now?.() ?? Date.now();
  const one = (id: string): Row | undefined => tx.get<Row>("SELECT * FROM records_comment WHERE id = ?", id);
  const live = (ctx: CommentsCtx, id: string): Row => {
    const r = one(id);
    if (!r || r.deleted_at !== null) return fail(ctx, "validation.not_found", "That comment does not exist.");
    return r;
  };
  /** Reading the record as the caller is the access check: a record you cannot see has no comments you can see. */
  const see = async (ctx: CommentsCtx, type: string, recordId: string): Promise<Record<string, unknown>> => {
    const got = (await ctx.call("records.get" as never, { type, recordId })) as { record?: { fields?: Record<string, unknown> } } | undefined;
    if (!got?.record) return fail(ctx, "validation.not_found", `no ${type} ${recordId}`);
    return got.record.fields ?? {};
  };
  const out = (r: Row): CommentRow => {
    const replying = tx.all<{ agent_id: string }>("SELECT agent_id FROM records_comment_agent WHERE comment_id = ? AND state = 'pending' ORDER BY agent_id", r.id).map((a) => a.agent_id);
    return {
      commentId: r.id, type: r.type, recordId: r.record_id, ...(r.parent_id ? { parentId: r.parent_id } : {}), text: r.text, by: r.author, at: r.at,
      ...(r.edited_at !== null ? { editedAt: r.edited_at } : {}), resolved: r.resolved === 1, ...(r.resolved_by ? { resolvedBy: r.resolved_by } : {}),
      mentions: JSON.parse(r.mentions) as Mention[], replying,
    };
  };
  const rootOf = (r: Row): Row => (r.parent_id ? one(r.parent_id) ?? r : r);
  const titleOf = (fields: Record<string, unknown>, fallback: string): string => {
    for (const k of ["name", "title", "subject"]) { const v = fields[k]; if (typeof v === "string" && v.trim() !== "") return v.trim(); }
    return fallback;
  };
  const cleanMentions = (ctx: CommentsCtx, raw: readonly Mention[] | undefined): Mention[] => {
    const seen = new Set<string>();
    const list: Mention[] = [];
    for (const m of raw ?? []) {
      if (seen.has(m.id)) continue;
      if (m.kind === "person" ? !PERSON.test(m.id) : !AGENT.test(m.id)) return fail(ctx, "validation.bad_input", `That is not ${m.kind === "agent" ? "an agent" : "a person"} you can mention.`);
      seen.add(m.id);
      list.push({ kind: m.kind, id: m.id });
    }
    return list;
  };

  /** A mentioned person gets an Answer request that names the record and the comment. Best effort: a refused request never loses the comment. */
  async function notifyPerson(ctx: CommentsCtx, c: Row, who: string, title: string): Promise<void> {
    try {
      await ctx.call("tasks.create" as never, {
        kind: "answer", title: `Mentioned on ${title}`, summary: c.text.length > 240 ? `${c.text.slice(0, 237)}...` : c.text,
        assigned: { kind: "person", id: who }, recordId: c.record_id, source: { kind: "manual", id: c.id }, why: "comment", idempotencyKey: `rcm-ask:${c.id}:${who}`,
      });
    } catch (e) { ctx.log?.warn("a comment mention could not raise a request", { commentId: c.id, who, error: String((e as Error)?.message ?? e) }); }
  }

  /** The thread so far, as the agent's first message, with the one way to answer. */
  function promptFor(c: Row, root: Row, title: string, names: Map<string, string>): string {
    const all = [root, ...tx.all<Row>("SELECT * FROM records_comment WHERE parent_id = ? AND deleted_at IS NULL ORDER BY at, id", root.id)];
    const lines = all.map((x) => `- ${names.get(x.author) ?? x.author}: ${x.text}`);
    return [
      `You were mentioned in a comment on ${c.type} "${title}" (${c.type} ${c.record_id}).`,
      "The thread so far:", ...lines,
      "",
      `Answer it with one short comment under the thread: call records.comments.add with type "${c.type}", recordId "${c.record_id}", parentId "${root.id}" and your text.`,
      "Do not start a chat. Read the record and its history first if you need to. Anything that leaves Vyre still waits for approval.",
    ].join("\n");
  }

  async function runAgent(ctx: CommentsCtx, c: Row, root: Row, agentId: string, title: string): Promise<void> {
    tx.run("INSERT OR REPLACE INTO records_comment_agent (comment_id, agent_id, thread_id, state) VALUES (?, ?, NULL, 'pending')", c.id, agentId);
    try {
      const names = new Map<string, string>();
      // one pane per thread and agent: a second mention in the same thread goes to the same pane, so the agent keeps what it read
      const res = (await ctx.call("chat.start" as never, {
        kind: "ask", agentIds: [agentId], scopeType: "record", scopeId: c.record_id, recordId: c.record_id, title: "Comment replies", idempotencyKey: `rcm:${root.id}:${agentId}`,
      })) as { thread?: { threadId?: string } } | undefined;
      const threadId = res?.thread?.threadId;
      if (!threadId) throw new Error("no pane");
      tx.run("UPDATE records_comment_agent SET thread_id = ? WHERE comment_id = ? AND agent_id = ?", threadId, c.id, agentId);
      // The pane keeps the person's own mode (Ask first by default): the agent's other writes wait for their yes. Its reply is a comment, which never waits (records.comments.add is allowed in every mode).
      await ctx.call("chat.post" as never, { threadId, body: promptFor(c, root, title, names), mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `rcm-post:${c.id}:${agentId}` });
    } catch (e) {
      tx.run("UPDATE records_comment_agent SET state = 'failed' WHERE comment_id = ? AND agent_id = ?", c.id, agentId);
      ctx.log?.warn("a mentioned agent could not be started", { commentId: c.id, agentId, error: String((e as Error)?.message ?? e) });
    }
  }

  return {
    "records.comments.list": async (ctx, input) => {
      ensureTables(tx);
      await see(ctx, input.type, input.recordId);
      const rows = tx.all<Row>("SELECT * FROM records_comment WHERE type = ? AND record_id = ? AND deleted_at IS NULL ORDER BY at, id", input.type, input.recordId);
      const resolvedRoots = new Set(rows.filter((r) => r.parent_id === null && r.resolved === 1).map((r) => r.id));
      const shown = input.includeResolved === true ? rows : rows.filter((r) => !resolvedRoots.has(r.parent_id ?? r.id));
      return { comments: shown.map(out), resolvedCount: resolvedRoots.size };
    },

    "records.comments.add": async (ctx, input) => {
      ensureTables(tx);
      const fields = await see(ctx, input.type, input.recordId);
      const text = input.text.trim();
      if (text === "" || text.length > MAX_TEXT) return fail(ctx, "validation.bad_input", `A comment is 1 to ${MAX_TEXT} characters.`);
      const mentions = cleanMentions(ctx, input.mentions);
      let parent: Row | undefined;
      if (input.parentId !== undefined) {
        parent = live(ctx, input.parentId);
        if (parent.record_id !== input.recordId) return fail(ctx, "validation.bad_input", "That comment is on another record.");
      }
      const root = parent ? rootOf(parent) : undefined;
      const id = mintId("rcm");
      const at = now(ctx);
      // a reply joins the thread's root, so a thread is two levels: the comment and its replies
      tx.run(
        "INSERT INTO records_comment (id, type, record_id, parent_id, text, author, at, resolved, mentions) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
        id, input.type, input.recordId, root?.id ?? null, text, ctx.principal.id, at, JSON.stringify(mentions),
      );
      const row = one(id)!;
      // an agent that answers clears its own "is replying" on every comment of the thread
      if (ctx.principal.kind === "agent" && root) tx.run("UPDATE records_comment_agent SET state = 'done' WHERE agent_id = ? AND state = 'pending' AND comment_id IN (SELECT id FROM records_comment WHERE id = ? OR parent_id = ?)", ctx.principal.id, root.id, root.id);
      ctx.emit("record.comment_added" as EventName, `record/${input.recordId}`, { recordId: input.recordId, type: input.type, commentId: id, ...(root ? { parentId: root.id } : {}), mentions });
      const title = titleOf(fields, input.recordId);
      for (const m of mentions) {
        if (m.id === ctx.principal.id) continue;
        if (m.kind === "person") await notifyPerson(ctx, row, m.id, title);
        else if (ctx.principal.kind === "person") await runAgent(ctx, row, root ?? row, m.id, title);
      }
      return { comment: out(one(id)!) };
    },

    "records.comments.edit": async (ctx, input) => {
      ensureTables(tx);
      const r = live(ctx, input.commentId);
      await see(ctx, r.type, r.record_id);
      if (r.author !== ctx.principal.id) return fail(ctx, "permission.no_grant", "You can edit only your own comments.");
      const text = input.text.trim();
      if (text === "" || text.length > MAX_TEXT) return fail(ctx, "validation.bad_input", `A comment is 1 to ${MAX_TEXT} characters.`);
      if (text !== r.text) tx.run("UPDATE records_comment SET text = ?, edited_at = ? WHERE id = ?", text, now(ctx), r.id);
      return { comment: out(one(r.id)!) };
    },

    "records.comments.resolve": async (ctx, input) => {
      ensureTables(tx);
      const r = live(ctx, input.commentId);
      await see(ctx, r.type, r.record_id);
      const root = rootOf(r);
      if ((root.resolved === 1) !== input.resolved) {
        tx.run("UPDATE records_comment SET resolved = ?, resolved_by = ? WHERE id = ?", input.resolved ? 1 : 0, input.resolved ? ctx.principal.id : null, root.id);
        ctx.emit("record.comment_resolved" as EventName, `record/${root.record_id}`, { recordId: root.record_id, type: root.type, commentId: root.id, resolved: input.resolved });
      }
      return { comment: out(one(root.id)!) };
    },

    "records.comments.delete": async (ctx, input) => {
      ensureTables(tx);
      const r = one(input.commentId);
      if (!r || r.deleted_at !== null) return { deleted: false };
      await see(ctx, r.type, r.record_id);
      const manage = ctx.authorize?.({ perm: null, level: "manage" }, { type: "record", id: r.record_id }).effect === "allow";
      if (r.author !== ctx.principal.id && !manage) return fail(ctx, "permission.no_grant", "Only the author or someone who manages this record can delete a comment.");
      const at = now(ctx);
      // deleting a thread's first comment takes its replies with it
      tx.run("UPDATE records_comment SET deleted_at = ? WHERE id = ? OR parent_id = ?", at, r.id, r.id);
      return { deleted: true };
    },
  };
}
