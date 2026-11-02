// The person's side of signing an outside agent in. A client asks at /oauth/authorize (oauth.ts); here a signed-in person sees what asked and answers. These are capabilities and not a form on a page, so a press needs a session
// Bearer token that no other site can send, and none of them is a tool, so no agent can reach them: an outside agent cannot allow another client.
//   mcp.oauth.request      what an app says about itself, for the Allow sheet
//   mcp.oauth.allow        it becomes an agent this person owns, one grant; the tab that asked collects the code
//   mcp.oauth.decline      no, and the app is told
//   mcp.connected.*        the person's outside agents, the link to connect one, and Remove
//   mcp.activity.list      what one of them did
import { endpointOf, actorOf, boundServer, ensure, hasSetup, mintId, putSetup, raise, sessionBy } from "../projections.ts";
import type { McpCtx } from "../projections.ts";
import { clientBy, grantBy, grantsOfAgent, grantsOfPerson, insertGrant, liveGrant, redirectHostOf, requestBy, revokeGrant } from "../oauth.ts";
import type { GrantRow, RequestRow } from "../oauth.ts";
import { isSystemCall } from "../../../lib/trust.ts";

type Row = Record<string, unknown>;
export interface OauthCtx extends McpCtx { call?(cap: string, input: unknown): Promise<unknown> }

/** Who may answer: a person, signed in as themselves. Not an agent, not a service, and not an admin looking through someone else's eyes. */
function person(ctx: McpCtx): string {
  if (ctx.principal.kind !== "person" || (ctx.actingFor !== undefined && ctx.actingFor !== ctx.principal.id)) raise(ctx, "permission.no_grant", "Only a person can answer this, signed in as themselves.");
  return ctx.principal.id;
}

function openRequest(ctx: McpCtx, requestId: string): RequestRow {
  ensure(ctx.db);
  const r = requestBy(ctx.db, requestId);
  if (!r) raise(ctx, "validation.not_found", "That request is not here. Start again from the app you are connecting.");
  if (r.expiresAt <= ctx.now() || r.status !== "open") raise(ctx, "auth.expired", "That request has ended. Start again from the app you are connecting.");
  return r;
}

export async function oauthRequest(ctx: OauthCtx, input: { requestId: string }) {
  const me = person(ctx);
  const r = openRequest(ctx, input.requestId);
  const client = clientBy(ctx.db, r.clientId);
  if (!client) raise(ctx, "validation.not_found", "That request is not here. Start again from the app you are connecting.");
  const host = redirectHostOf(r.redirectUri);
  const space = await ctx.call?.("spaces.get", {}).catch(() => null) as { space?: { name?: string } } | null | undefined;
  return { request: {
    requestId: r.requestId, clientName: client.name, ...(host ? { redirectHost: host } : {}), spaceName: space?.space?.name ?? "this Space", match: r.match, expiresAt: r.expiresAt, rejoins: liveGrant(ctx.db, r.clientId, me, r.resource) !== null,
    ...(manages(ctx) ? { canSetup: true } : {}),
  } };
}

/** The sign-in this person last made with this client, if it can carry on: not one they removed. An app that signs in again stays the same agent. */
function resumable(ctx: McpCtx, clientId: string, me: string, resource: string): GrantRow | null {
  const r = (ctx.db.all("SELECT grant_id FROM mcp_oauth_grants WHERE client_id = ? AND person = ? AND resource = ? AND (revoked_why IS NULL OR revoked_why IN ('replaced', 'code replayed', 'refresh replayed')) ORDER BY created_at DESC LIMIT 1", clientId, me, resource) as Row[])[0];
  return r ? grantBy(ctx.db, String(r["grant_id"])) : null;
}

export async function oauthAllow(ctx: OauthCtx, input: { requestId: string; setup?: boolean }) {
  const me = person(ctx);
  // "Act for me, including setup" (owner ruling 3 Nov): only a person who holds those rights can hand them on, and only as an explicit choice
  if (input.setup === true && !manages(ctx)) raise(ctx, "permission.role_lacks_permission", "Only an owner or admin can let an agent do setup. Allow it to ask you first instead.");
  const r = openRequest(ctx, input.requestId);
  const client = clientBy(ctx.db, r.clientId);
  if (!client) raise(ctx, "validation.not_found", "That request is not here. Start again from the app you are connecting.");
  if (!ctx.call) raise(ctx, "internal.unexpected", "Agents are not available right now.");
  const now = ctx.now();
  // the press is claimed first, in one write: a second press, or a press from a second window, finds nothing to claim
  if (ctx.db.run("UPDATE mcp_oauth_requests SET status = 'taken', person = ? WHERE request_id = ? AND status = 'open'", me, r.requestId).changes !== 1) raise(ctx, "auth.expired", "That request has ended. Start again from the app you are connecting.");
  try {
    const before = resumable(ctx, r.clientId, me, r.resource);
    let agentId: string | undefined;
    let name = client.name;
    if (before) {
      const seen = await ctx.call("agents.get", { agentId: before.agentId }).catch(() => null) as { agent?: { name?: string } } | null;
      if (seen?.agent) { agentId = before.agentId; name = seen.agent.name ?? name; }
    }
    if (agentId === undefined) {
      const made = (await ctx.call("agents.outside.connect", { clientName: client.name })) as { agentId: string; name: string };
      agentId = made.agentId; name = made.name;
    }
    const grantId = mintId("ogr", now);
    if (before && before.revokedAt === undefined) { const ended = revokeGrant(ctx.db, before.grantId, "replaced", now); if (ended) boundServer()?.end(ended); }
    const host = redirectHostOf(r.redirectUri);
    insertGrant(ctx.db, { grantId, clientId: r.clientId, clientName: client.name, person: me, agentId, resource: r.resource, ...(host ? { redirectHost: host } : {}), createdAt: now });
    ctx.db.run("UPDATE mcp_oauth_requests SET status = 'allowed', agent_id = ?, grant_id = ? WHERE request_id = ?", agentId, grantId, r.requestId);
    ctx.emit("mcp.client_allowed", agentId, { agentId, person: me, clientName: client.name, ...(host ? { redirectHost: host } : {}) });
    // the choice made at this Allow is the agent's grant from now on, whatever an earlier sign-in of the same app had
    const setup = input.setup === true;
    if (setup || hasSetup(ctx.db, agentId, me)) {
      putSetup(ctx.db, agentId, me, setup, me, now);
      ctx.emit("mcp.setup_changed", agentId, { agentId, person: me, setup, by: me });
    }
    return { agentId, name, setup };
  } catch (e) {
    ctx.db.run("UPDATE mcp_oauth_requests SET status = 'open', person = NULL WHERE request_id = ? AND status = 'taken'", r.requestId);
    throw e;
  }
}

export function oauthDecline(ctx: McpCtx, input: { requestId: string }) {
  const me = person(ctx);
  const r = openRequest(ctx, input.requestId);
  const client = clientBy(ctx.db, r.clientId);
  if (ctx.db.run("UPDATE mcp_oauth_requests SET status = 'declined', person = ? WHERE request_id = ? AND status = 'open'", me, r.requestId).changes === 1) {
    ctx.emit("mcp.client_declined", r.requestId, { requestId: r.requestId, person: me, clientName: client?.name ?? "An MCP app" });
  }
  return { declined: true };
}

export function oauthReplayed(ctx: McpCtx, input: { agentId: string; person: string; why: string }) {
  if (!isSystemCall(ctx)) raise(ctx, "permission.no_grant", "Only the server says that.");
  ctx.emit("mcp.client_replayed", input.agentId, input);
  return { noted: true };
}

// ---- yours --------------------------------------------------------------------------------------------------------------------------------------------

export function connectedList(ctx: McpCtx, input: { all?: boolean } = {}) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  // the Console's list: every outside agent in the Space, for an owner or admin, so a setup grant can be seen and taken back
  if (input.all === true && !manages(ctx)) raise(ctx, "permission.no_grant", "Only an owner or admin sees every outside agent.");
  const grants = input.all === true ? (ctx.db.all("SELECT * FROM mcp_oauth_grants WHERE revoked_at IS NULL ORDER BY created_at DESC") as Row[]).map((r) => String(r["person"])).filter((p, i, a) => a.indexOf(p) === i).flatMap((p) => grantsOfPerson(ctx.db, p)) : grantsOfPerson(ctx.db, me);
  const agents = grants.map((g) => {
    const s = g.sessionId ? sessionBy(ctx.db, "session_id", g.sessionId) : null;
    return { agentId: g.agentId, clientName: g.clientName, ...(g.redirectHost ? { redirectHost: g.redirectHost } : {}), connectedAt: g.createdAt, ...(s?.lastCallAt === undefined ? {} : { lastSeenAt: s.lastCallAt }), calls: s?.calls ?? 0, setup: hasSetup(ctx.db, g.agentId, g.person), ...(input.all === true ? { person: g.person } : {}) };
  });
  return { agents };
}

/** Turn an outside agent's setup grant on or off. On: its own person, who must hold the rights. Off: its person, or an owner or admin. A person only, signed in as themselves: never an agent. */
export function setupSet(ctx: McpCtx, input: { agentId: string; setup: boolean }) {
  ensure(ctx.db);
  const me = person(ctx);
  const owner = (ctx.db.all("SELECT person FROM mcp_oauth_grants WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", input.agentId) as Row[])[0];
  if (!owner) raise(ctx, "validation.not_found", "That outside agent is not here.");
  const its = String(owner["person"]);
  if (its !== me && !(manages(ctx) && input.setup === false)) raise(ctx, its === me || manages(ctx) ? "permission.no_grant" : "validation.not_found", its === me || manages(ctx) ? "Only its own person can let it do setup." : "That outside agent is not here.");
  if (input.setup && !manages(ctx)) raise(ctx, "permission.role_lacks_permission", "Only an owner or admin can let an agent do setup.");
  if (hasSetup(ctx.db, input.agentId, its) !== input.setup) {
    putSetup(ctx.db, input.agentId, its, input.setup, me, ctx.now());
    ctx.emit("mcp.setup_changed", input.agentId, { agentId: input.agentId, person: its, setup: input.setup, by: me });
  }
  return { setup: input.setup };
}

export function connectedLink(_ctx: McpCtx, _input: Record<string, never>) {
  const url = endpointOf().url;
  return { url, claudeCode: `claude mcp add --transport http vyre ${url}` };
}

const manages = (ctx: McpCtx): boolean => ctx.authorize({ perm: "access.manage", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";

export async function connectedRemove(ctx: OauthCtx, input: { agentId: string }) {
  const me = person(ctx);
  ensure(ctx.db);
  const grants = grantsOfAgent(ctx.db, input.agentId);
  const seen = (ctx.db.all("SELECT person FROM mcp_oauth_grants WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", input.agentId) as Row[])[0];
  if (!seen) raise(ctx, "validation.not_found", "That outside agent is not here.");
  if (seen["person"] !== me && !manages(ctx)) raise(ctx, "validation.not_found", "That outside agent is not here.");
  const now = ctx.now();
  for (const g of grants) { const ended = revokeGrant(ctx.db, g.grantId, "removed", now); if (ended) boundServer()?.end(ended); }
  ctx.db.run("UPDATE mcp_oauth_grants SET revoked_why = 'removed' WHERE agent_id = ?", input.agentId);
  ctx.emit("mcp.client_removed", input.agentId, { agentId: input.agentId, by: me });
  await ctx.call?.("agents.delete", { agentId: input.agentId });
  return { removed: true };
}

export function activityList(ctx: McpCtx, input: { agentId: string; cursor?: string; limit?: number }) {
  ensure(ctx.db);
  const me = actorOf(ctx);
  const owner = (ctx.db.all("SELECT person FROM mcp_oauth_grants WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", input.agentId) as Row[])[0];
  if (!owner || (owner["person"] !== me && !manages(ctx))) raise(ctx, "validation.not_found", "That outside agent is not here.");
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const offset = input.cursor !== undefined && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const rows = ctx.db.all("SELECT * FROM mcp_activity WHERE agent_id = ? ORDER BY at DESC, id DESC LIMIT ? OFFSET ?", input.agentId, limit + 1, offset) as Row[];
  const page = rows.slice(0, limit).map((r) => ({
    id: String(r["id"]), tool: String(r["tool"]), ...(r["cap"] ? { cap: String(r["cap"]) } : {}), outcome: String(r["outcome"]) as "ok" | "error" | "held", ...(r["thread_id"] ? { threadId: String(r["thread_id"]) } : {}), ...(r["task_id"] ? { taskId: String(r["task_id"]) } : {}), at: Number(r["at"]),
  }));
  return { rows: page, ...(rows.length > limit ? { next: String(offset + limit) } : {}) };
}

/** An agent went to Trash some other way than Remove: its sign-in ends with it. Safe to repeat. Called by the mcp.agent_gone consumer. */
export function onAgentDeleted(ctx: McpCtx, event: { payload: { agentId?: unknown } }): string[] {
  ensure(ctx.db);
  const id = event.payload.agentId;
  if (typeof id !== "string") return [];
  const now = ctx.now();
  const ended: string[] = [];
  for (const g of grantsOfAgent(ctx.db, id)) { const s = revokeGrant(ctx.db, g.grantId, "removed", now); ended.push(g.grantId); if (s) boundServer()?.end(s); }
  return ended;
}

/** The answer of a call an outside agent asked its person for, as text in its queue: cut short, never a secret (the Gate keeps no answer of a vault.* call). */
const ANSWER_CHARS = 1700;
async function answerOf(ctx: OauthCtx, holdId: unknown): Promise<string> {
  if (typeof holdId !== "string" || !ctx.call) return "";
  try {
    const got = (await ctx.call("gate.result.take", { holdId })) as { found?: boolean; result?: unknown } | null;
    if (!got?.found || got.result === undefined || got.result === null) return "";
    const text = JSON.stringify(got.result);
    return ` The answer: ${text.length > ANSWER_CHARS ? `${text.slice(0, ANSWER_CHARS - 1)}…` : text}`;
  } catch { return ""; }
}

/** A person answered a call an outside agent was held on: the answer waits in its queue, because nothing can reach it. A call that was never an outside agent's finds no row here. Safe to repeat: the queue keeps one job per task and kind. */
export async function onHoldAnswered(ctx: OauthCtx, event: { name: string; payload: { taskId?: unknown; holdId?: unknown; mode?: unknown; note?: unknown; askedBy?: unknown } }): Promise<string[]> {
  ensure(ctx.db);
  const taskId = event.payload.taskId;
  if (typeof taskId !== "string" || !ctx.call) return [];
  const row = (ctx.db.all("SELECT agent_id, person, thread_id, tool FROM mcp_activity WHERE task_id = ? AND outcome = 'held' ORDER BY at DESC LIMIT 1", taskId) as Row[])[0];
  if (!row) return [];
  const yes = event.name === "gate.approved";
  // a call the agent asked its person for ran as that person: its answer goes back with the yes (docs/ask-the-person.md)
  const asked = event.payload.askedBy !== undefined;
  const ran = asked ? `${String(row["tool"])} ran as the person you act for.${await answerOf(ctx, event.payload.holdId)}` : `${String(row["tool"])} ran.`;
  const text = yes ? `Approved. ${ran}` : event.name === "gate.expired" ? `Nobody answered. ${String(row["tool"])} did not run.` : `Not approved. ${String(row["tool"])} did not run.${typeof event.payload.note === "string" ? ` ${event.payload.note}` : ""}`;
  await ctx.call("agents.outside.enqueue", { agentId: String(row["agent_id"]), kind: "answer", taskId, ...(row["thread_id"] ? { threadId: String(row["thread_id"]) } : {}), asker: String(row["person"]), title: yes ? "Approved" : "Not approved", text });
  return [taskId];
}

/**
 * A key an outside agent asked a person to paste was saved or declined (vault_item_put from outside, docs/ask-the-person.md). An agent in a chat is told there (the engine mentions it); one with no chat is told
 * in its queue. It gets the key's name to pass as a handle, never the value.
 */
export async function onKeyAnswered(ctx: OauthCtx, event: { name: string; payload: { requestId?: unknown; name?: unknown; note?: unknown; agentId?: unknown; threadId?: unknown } }): Promise<string[]> {
  ensure(ctx.db);
  const p = event.payload;
  if (typeof p.agentId !== "string" || typeof p.requestId !== "string" || p.threadId !== undefined || !ctx.call) return [];
  const owner = (ctx.db.all("SELECT person FROM mcp_oauth_grants WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", p.agentId) as Row[])[0];
  if (!owner) return [];
  const key = typeof p.name === "string" ? p.name : "the key";
  const yes = event.name === "vault.request_fulfilled";
  const text = yes ? `The key was saved in the Vault. Pass #${key} where a handle goes; the value stays in the Vault.` : `The key ${key} was not added.${typeof p.note === "string" ? ` ${p.note}` : ""}`;
  await ctx.call("agents.outside.enqueue", { agentId: p.agentId, kind: "answer", asker: String(owner["person"]), title: yes ? "Key saved" : "Key not added", text });
  return [p.requestId];
}
