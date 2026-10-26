// Local history enters through this stable payload boundary. Native provider
// adapters discover and parse their own stores; they never write projections.
import { clean, ensure, me, newId, raise } from "../projections.ts";
import type { ImportCtx, In } from "../projections.ts";

type Provider = "codex" | "claude_code";
type Role = "user" | "assistant";
interface Repo { remote?: string; root?: string }
interface SourceMessage { sourceMessageId: string; role: Role; text: string; at: number }
interface SourceSession { sourceSessionId: string; title?: string; startedAt: number; repo?: Repo; messages: SourceMessage[] }
type Destination = { kind: "project"; projectId: string } | { kind: "imported_sessions" };

const REMOTE = /^(?:https?:\/\/|git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/i;
const tempRoot = (root: string | undefined): boolean => !root || root === "/" || root === "/Users" || /(^|\/)(tmp|var\/folders|private\/tmp|home)(\/|$)/.test(root);

function identity(repo: Repo | undefined): { key: string; title: string } | undefined {
  if (!repo?.root || tempRoot(repo.root) || !repo.remote) return undefined;
  const m = repo.remote.trim().match(REMOTE);
  if (!m) return undefined;
  const remote = `${m[1]!.toLowerCase()}/${m[2]!.replace(/\.git$/i, "").toLowerCase()}`;
  return { key: `${remote}|${repo.root.replace(/\/+$/, "")}`, title: m[2]!.replace(/\.git$/i, "").split("/").at(-1) || "Imported project" };
}

function checked(ctx: ImportCtx, input: In): { provider: Provider; sourceKey: string; sessions: SourceSession[] } {
  if (input.consent?.previewedAt === undefined || input.consent?.confirmedAt === undefined || input.consent.confirmedAt < input.consent.previewedAt) {
    raise(ctx, "validation.precondition_failed", "Open the preview and confirm before importing local history.");
  }
  if (input.provider !== "codex" && input.provider !== "claude_code") raise(ctx, "validation.bad_input", "That session provider is not supported.");
  if (typeof input.sourceKey !== "string" || input.sourceKey.trim() === "") raise(ctx, "validation.bad_input", "A source key is required.");
  if (!Array.isArray(input.sessions)) raise(ctx, "validation.bad_input", "Sessions must be an array.");
  for (const s of input.sessions) {
    if (!s || typeof s.sourceSessionId !== "string" || !Array.isArray(s.messages)) raise(ctx, "validation.bad_input", "A session payload is malformed.");
    for (const m of s.messages) {
      if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.text !== "string" || typeof m.sourceMessageId !== "string") {
        raise(ctx, "validation.bad_input", "Only visible user and assistant text may be imported.");
      }
    }
  }
  return input as { provider: Provider; sourceKey: string; sessions: SourceSession[] };
}

async function destination(ctx: ImportCtx, session: SourceSession): Promise<{ destination: Destination; identityKey?: string }> {
  const repo = identity(session.repo);
  if (!repo) return { destination: { kind: "imported_sessions" } };
  const prior = ctx.db.all("SELECT projectId FROM import_project_binding WHERE identityKey = ?", repo.key) as Array<Record<string, unknown>>;
  if (prior[0]?.["projectId"]) return { destination: { kind: "project", projectId: String(prior[0]["projectId"]) }, identityKey: repo.key };
  const made = await ctx.call?.("projects.create", { type: "project", title: repo.title, summary: "Imported local coding sessions" }, { idempotencyKey: `sessions-project:${repo.key}` }) as { projectId?: string } | undefined;
  if (!made?.projectId) raise(ctx, "internal.unexpected", "The Project service did not create the imported project.");
  ctx.db.run("INSERT OR IGNORE INTO import_project_binding (identityKey, projectId, createdAt) VALUES (?, ?, ?)", repo.key, made.projectId, ctx.now());
  return { destination: { kind: "project", projectId: made.projectId }, identityKey: repo.key };
}

export async function sessionsImport(ctx: ImportCtx, raw: In): Promise<unknown> {
  ensure(ctx.db);
  const { provider, sourceKey, sessions } = checked(ctx, raw);
  const owner = me(ctx);
  ctx.db.run("INSERT OR IGNORE INTO import_session_source (sourceKey, provider, owner, createdAt) VALUES (?, ?, ?, ?)", sourceKey, provider, owner, ctx.now());
  const out: Array<{ conversationId: string; provider: Provider; destination: Destination }> = [];
  let imported = 0, updated = 0;
  for (const source of sessions) {
    const existing = ctx.db.all("SELECT conversationId, projectId, destinationKind FROM import_conversation WHERE sourceKey = ? AND sourceSessionId = ?", sourceKey, source.sourceSessionId) as Array<Record<string, unknown>>;
    if (existing[0]) {
      const row = existing[0];
      const conversationId = String(row["conversationId"]);
      for (const m of source.messages) {
        const priorMessage = (ctx.db.all("SELECT text FROM import_message WHERE conversationId = ? AND sourceMessageId = ?", conversationId, m.sourceMessageId) as Array<Record<string, unknown>>)[0];
        if (!priorMessage) {
          ctx.db.run("INSERT INTO import_message (messageId, conversationId, sourceKey, sourceMessageId, provider, role, text, at, immutable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)", newId("ims", ctx.now()), conversationId, sourceKey, m.sourceMessageId, provider, m.role, m.text, m.at);
          updated++;
        } else if (String(priorMessage["text"]) !== m.text) {
          ctx.db.run("INSERT OR IGNORE INTO import_session_conflict (conflictId, conversationId, sourceMessageId, incomingText, detectedAt) VALUES (?, ?, ?, ?, ?)", newId("iscf", ctx.now()), conversationId, m.sourceMessageId, m.text, ctx.now());
        }
      }
      out.push({ conversationId, provider, destination: row["destinationKind"] === "project" ? { kind: "project", projectId: String(row["projectId"]) } : { kind: "imported_sessions" } });
      continue;
    }
    const target = await destination(ctx, source);
    const conversationId = newId("isc", ctx.now());
    ctx.db.run("INSERT INTO import_conversation (conversationId, sourceKey, sourceSessionId, provider, owner, projectId, destinationKind, identityKey, title, startedAt, importedAt, immutable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", conversationId, sourceKey, source.sourceSessionId, provider, owner, target.destination.kind === "project" ? target.destination.projectId : null, target.destination.kind, target.identityKey ?? null, source.title ?? null, source.startedAt, ctx.now());
    for (const m of source.messages) ctx.db.run("INSERT OR IGNORE INTO import_message (messageId, conversationId, sourceKey, sourceMessageId, provider, role, text, at, immutable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)", newId("ims", ctx.now()), conversationId, sourceKey, m.sourceMessageId, provider, m.role, m.text, m.at);
    ctx.emit("sessions.imported", conversationId, clean({ conversationId, provider, sourceKey, projectId: target.destination.kind === "project" ? target.destination.projectId : undefined, messages: source.messages.length }));
    out.push({ conversationId, provider, destination: target.destination }); imported++;
  }
  return { imported, updated, sessions: out };
}

export async function sessionsContinue(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const row = (ctx.db.all("SELECT conversationId, projectId, continuedThreadId FROM import_conversation WHERE conversationId = ? AND owner = ?", input.conversationId, me(ctx)) as Array<Record<string, unknown>>)[0];
  if (!row) raise(ctx, "validation.not_found", "That imported conversation does not exist.");
  if (row["continuedThreadId"]) return { threadId: String(row["continuedThreadId"]), linkedFrom: String(row["conversationId"]) };
  if (typeof input.agentId !== "string" || !input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "Choose an agent to continue this session.");
  const chat = await ctx.call?.("chat.start", clean({ kind: "chat", agentIds: [input.agentId], title: "Continued imported session", scopeType: "imported_session", scopeId: row["conversationId"], first: input.first }), { idempotencyKey: `sessions-continue:${row["conversationId"]}` }) as { thread?: { threadId?: string } } | undefined;
  const threadId = chat?.thread?.threadId;
  if (!threadId) raise(ctx, "internal.unexpected", "The Chat service did not start a live chat.");
  ctx.db.run("UPDATE import_conversation SET continuedThreadId = ? WHERE conversationId = ?", threadId, row["conversationId"]);
  ctx.emit("sessions.continued", String(row["conversationId"]), { conversationId: row["conversationId"], threadId });
  return { threadId, linkedFrom: String(row["conversationId"]) };
}
