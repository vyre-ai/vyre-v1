// Local history enters through this stable payload boundary. Native provider
// adapters discover and parse their own stores; they never write projections.
import { clean, ensure, me, newId, raise } from "../projections.ts";
import type { ImportCtx, In } from "../projections.ts";

type Provider = "codex" | "claude_code";
type Role = "user" | "assistant";
interface Repo { remote?: string; root?: string }
interface SourceMessage { sourceMessageId: string; role: Role; text: string; at: number }
interface SourceSession { sourceSessionId: string; title?: string; startedAt: number; repo?: Repo; messages: SourceMessage[] }
type Scope = "personal" | "team";
type Destination = ({ kind: "project"; projectId: string } | { kind: "imported_sessions" }) & { scope: Scope; spaceId: string };
interface ResolvedDestination { scope: Scope; spaceId: string }

const REMOTE = /^(?:https?:\/\/|git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/i;
const tempRoot = (root: string | undefined): boolean => !root || root === "/" || root === "/Users" || /(^|\/)(tmp|var\/folders|private\/tmp|home)(\/|$)/.test(root);

function identity(repo: Repo | undefined): { key: string; title: string } | undefined {
  if (!repo?.root || tempRoot(repo.root) || !repo.remote) return undefined;
  const m = repo.remote.trim().match(REMOTE);
  if (!m) return undefined;
  const remote = `${m[1]!.toLowerCase()}/${m[2]!.replace(/\.git$/i, "").toLowerCase()}`;
  return { key: `${remote}|${repo.root.replace(/\/+$/, "")}`, title: m[2]!.replace(/\.git$/i, "").split("/").at(-1) || "Imported project" };
}

function checked(ctx: ImportCtx, input: In): { provider: Provider; sourceKey: string; sessions: SourceSession[]; scope: Scope } {
  if (input.consent?.previewedAt === undefined || input.consent?.confirmedAt === undefined || input.consent.confirmedAt < input.consent.previewedAt) {
    raise(ctx, "validation.precondition_failed", "Open the preview and confirm before importing local history.");
  }
  if (input.provider !== "codex" && input.provider !== "claude_code") raise(ctx, "validation.bad_input", "That session provider is not supported.");
  if (typeof input.sourceKey !== "string" || input.sourceKey.trim() === "") raise(ctx, "validation.bad_input", "A source key is required.");
  if (!Array.isArray(input.sessions)) raise(ctx, "validation.bad_input", "Sessions must be an array.");
  const scope: Scope = input.destination?.kind === undefined || input.destination?.kind === "personal" ? "personal" : input.destination?.kind === "team" ? "team" : raise(ctx, "validation.bad_input", "Choose Personal or Team as the import destination.");
  if (scope === "team" && (input.destination?.confirmedAt === undefined || input.destination.confirmedAt < input.consent.confirmedAt)) {
    raise(ctx, "validation.precondition_failed", "Confirm the Team Space destination before importing local history there.");
  }
  if (scope === "team" && (typeof input.destination?.spaceId !== "string" || input.destination.spaceId === "")) {
    raise(ctx, "validation.bad_input", "Choose the Team Space that will receive this import.");
  }
  for (const s of input.sessions) {
    if (!s || typeof s.sourceSessionId !== "string" || !Array.isArray(s.messages)) raise(ctx, "validation.bad_input", "A session payload is malformed.");
    for (const m of s.messages) {
      if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.text !== "string" || typeof m.sourceMessageId !== "string") {
        raise(ctx, "validation.bad_input", "Only visible user and assistant text may be imported.");
      }
    }
  }
  return { ...(input as { provider: Provider; sourceKey: string; sessions: SourceSession[] }), scope };
}

async function resolved(ctx: ImportCtx, owner: string, raw: In, scope: Scope): Promise<ResolvedDestination> {
  if (!ctx.sessionDestination) raise(ctx, "internal.unexpected", "The destination Space router is not available right now.");
  const request = scope === "team"
    ? { kind: "team" as const, spaceId: String(raw.destination.spaceId) }
    : { kind: "personal" as const };
  const target = await ctx.sessionDestination.resolve(owner, request);
  if (target.kind !== scope || typeof target.spaceId !== "string" || target.spaceId === "") {
    raise(ctx, "validation.precondition_failed", "That destination Space is not authorized for this import.");
  }
  return { scope, spaceId: target.spaceId };
}

async function destination(ctx: ImportCtx, owner: string, targetSpaceId: string, scope: Scope, session: SourceSession): Promise<{ destination: Destination; identityKey?: string }> {
  const repo = identity(session.repo);
  if (!repo) return { destination: { kind: "imported_sessions", scope, spaceId: targetSpaceId } };
  const prior = ctx.db.all("SELECT projectId FROM import_project_binding WHERE spaceId = ? AND owner = ? AND destinationScope = ? AND identityKey = ?", targetSpaceId, owner, scope, repo.key) as Array<Record<string, unknown>>;
  if (prior[0]?.["projectId"]) return { destination: { kind: "project", projectId: String(prior[0]["projectId"]), scope, spaceId: targetSpaceId }, identityKey: repo.key };
  const made = await ctx.call?.("projects.create", { type: "project", title: repo.title, summary: "Imported local coding sessions" }, { idempotencyKey: `sessions-project:${targetSpaceId}:${owner}:${scope}:${repo.key}` }) as { projectId?: string } | undefined;
  if (!made?.projectId) raise(ctx, "internal.unexpected", "The Project service did not create the imported project.");
  ctx.db.run("INSERT OR IGNORE INTO import_project_binding (spaceId, owner, destinationScope, identityKey, projectId, createdAt) VALUES (?, ?, ?, ?, ?, ?)", targetSpaceId, owner, scope, repo.key, made.projectId, ctx.now());
  return { destination: { kind: "project", projectId: made.projectId, scope, spaceId: targetSpaceId }, identityKey: repo.key };
}

export async function sessionsImport(ctx: ImportCtx, raw: In): Promise<unknown> {
  ensure(ctx.db);
  const { provider, sourceKey, sessions, scope } = checked(ctx, raw);
  const owner = me(ctx);
  const target = await resolved(ctx, owner, raw, scope);
  if (target.spaceId !== ctx.space) return ctx.sessionDestination!.invoke(target.spaceId, "sessions.import", raw);
  ctx.db.run("INSERT OR IGNORE INTO import_session_source (spaceId, owner, destinationScope, sourceKey, provider, createdAt) VALUES (?, ?, ?, ?, ?, ?)", target.spaceId, owner, scope, sourceKey, provider, ctx.now());
  const out: Array<{ conversationId: string; provider: Provider; destination: Destination }> = [];
  let imported = 0, updated = 0;
  for (const source of sessions) {
    const existing = ctx.db.all("SELECT conversationId, projectId, destinationKind FROM import_conversation WHERE spaceId = ? AND owner = ? AND destinationScope = ? AND sourceKey = ? AND sourceSessionId = ?", target.spaceId, owner, scope, sourceKey, source.sourceSessionId) as Array<Record<string, unknown>>;
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
      out.push({ conversationId, provider, destination: row["destinationKind"] === "project" ? { kind: "project", projectId: String(row["projectId"]), scope, spaceId: target.spaceId } : { kind: "imported_sessions", scope, spaceId: target.spaceId } });
      continue;
    }
    const bound = await destination(ctx, owner, target.spaceId, scope, source);
    const conversationId = newId("isc", ctx.now());
    ctx.db.run("INSERT INTO import_conversation (conversationId, spaceId, sourceKey, sourceSessionId, provider, owner, destinationScope, projectId, destinationKind, identityKey, title, startedAt, importedAt, immutable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)", conversationId, target.spaceId, sourceKey, source.sourceSessionId, provider, owner, scope, bound.destination.kind === "project" ? bound.destination.projectId : null, bound.destination.kind, bound.identityKey ?? null, source.title ?? null, source.startedAt, ctx.now());
    for (const m of source.messages) ctx.db.run("INSERT OR IGNORE INTO import_message (messageId, conversationId, sourceKey, sourceMessageId, provider, role, text, at, immutable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)", newId("ims", ctx.now()), conversationId, sourceKey, m.sourceMessageId, provider, m.role, m.text, m.at);
    ctx.emit("sessions.imported", conversationId, clean({ conversationId, provider, sourceKey, projectId: bound.destination.kind === "project" ? bound.destination.projectId : undefined, scope, spaceId: target.spaceId, messages: source.messages.length }));
    out.push({ conversationId, provider, destination: bound.destination }); imported++;
  }
  return { imported, updated, sessions: out };
}

export async function sessionsContinue(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  if (typeof input.destinationSpaceId !== "string" || input.destinationSpaceId === "") raise(ctx, "validation.bad_input", "Choose the destination Space that owns this imported conversation.");
  if (input.destinationScope !== "personal" && input.destinationScope !== "team") raise(ctx, "validation.bad_input", "Choose the destination scope that owns this imported conversation.");
  if (!ctx.sessionDestination) raise(ctx, "internal.unexpected", "The destination Space router is not available right now.");
  const routed = await ctx.sessionDestination.resolve(me(ctx), input.destinationScope === "personal" ? { kind: "personal" } : { kind: "team", spaceId: input.destinationSpaceId });
  if (routed.spaceId !== input.destinationSpaceId || routed.kind !== input.destinationScope) {
    raise(ctx, "validation.not_found", "That imported conversation does not exist.");
  }
  if (routed.spaceId !== ctx.space) {
    return ctx.sessionDestination.invoke(routed.spaceId, "sessions.continue", input);
  }
  const row = (ctx.db.all("SELECT conversationId, projectId, continuedThreadId FROM import_conversation WHERE conversationId = ? AND owner = ? AND spaceId = ? AND destinationScope = ?", input.conversationId, me(ctx), routed.spaceId, routed.kind) as Array<Record<string, unknown>>)[0];
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
