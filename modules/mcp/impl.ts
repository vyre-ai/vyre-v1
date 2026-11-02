// mcp module entry (lane L2). The host loads the generated stubs while host/modules.json says `status: 'stub'` and this file once it says `live` (ruling 25).
// Also here: the runtime that puts the MCP server (agent/src/mcp) on this module's tables. The host mounts `runtime.handle` at the Space's /mcp address and on loopback for CLI engines, and `runtime.oauth` at /oauth/* and the
// /.well-known addresses a client signs in through. What an outside agent does is written here too: one activity row per call, its status, and its steps as a message in the chat it is working in.
import { CONNECTOR_CHAT, CONNECTOR_TOOLS, CREW_TOOLS, CRM_CHAT, CRM_TOOLS } from "../../lib/connector-chat.ts";
import { ABOUT_VYRE_TOOLS } from "../../lib/about-vyre.ts";
import { createMcpServer } from "../../agent/src/mcp/server.ts";
import { modePair } from "../../agent/src/tools/local.ts";
import { recordWork, sessionWorkKey } from "../../agent/src/tools/work-cards.ts";
import type { McpCaller, McpServer, McpServerDeps } from "../../agent/src/mcp/types.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import { handlers as table } from "./handlers/index.ts";
import { onAgentDeleted, onHoldAnswered } from "./handlers/oauth.ts";
import type { OauthCtx } from "./handlers/oauth.ts";
import type { Handler } from "../../host/src/invoke.ts";
import { bindEndpoint, bindServer, boundServer, driverForToken, ensure, insertSession, isLive, loadGenerated, mintId, outsideCaller, sessionBy, touchSession } from "./projections.ts";
import type { Db, Endpoint, McpCtx } from "./projections.ts";
import { allowTab, refusalPage } from "./allow-page.ts";
import { beginAuthorize, challenge, collect, createLimiter, exchange, grantForAccess, protectedResource, registerClient, serverMetadata } from "./oauth.ts";

export const handlers: Record<string, Handler> = table as unknown as Record<string, Handler>;

export interface RuntimeOptions {
  db: Db;
  space: string;
  invoke: Invoke;
  now?: () => number;
  endpoint?: Endpoint | (() => Endpoint);
  /** Are this agent and the person it acts for still active members? Read on every request, so a person removed or suspended ends their agents at once. Unset means no. */
  active?: (agentId: string, person: string) => boolean;
  /** The Space's name, for the page a client opens. */
  spaceName?: () => Promise<string>;
  /** A capability called as the host itself. */
  system?: (cap: string, input: unknown) => Promise<unknown>;
  /** A web app a person with no Vyre app can sign in with, shown on the tab a client opens. */
  webApp?: string;
  info?: McpServerDeps["info"];
  allowedOrigins?: McpServerDeps["allowedOrigins"];
}

/**
 * A CLI engine's session works for one chat. The chat's mode (Ask first, Auto, Plan) decides what its tools may do, so it is read when the session opens: the engine opens a new session, with a new token, whenever
 * the mode changes (the pool key holds it). A chat that cannot be read leaves the caller as it was; the Gate and access checks still stand.
 */
export async function withChatMode(o: RuntimeOptions, caller: McpCaller): Promise<McpCaller> {
  if (caller.kind !== "driver" || caller.threadId === undefined) return caller;
  try {
    const seed = { space: o.space, principal: caller.principal, ...(caller.actingFor ? { actingFor: caller.actingFor } : {}), origin: "mcp" as const };
    const r = await o.invoke("threads.get", { threadId: caller.threadId }, seed);
    const thread = r.status === "ok" ? (r.output as { thread?: { mode?: unknown; title?: unknown; kind?: unknown; scopeType?: unknown; scopeId?: unknown } } | null)?.thread : undefined;
    const mode = thread?.mode;
    // the same facts the API tools read for a turn (modules/engine/api-tools.ts), so an Ask or a task thread is the same on every driver
    const facts: Partial<McpCaller> = typeof thread?.kind !== "string" ? {} : { threadKind: thread.kind as McpCaller["threadKind"], ...(typeof thread.scopeType === "string" && typeof thread.scopeId === "string" ? { scope: { type: thread.scopeType, id: thread.scopeId } } : {}) };
    if (thread?.kind === "ask" && facts.scope) {
      const l = await o.invoke("chat.ask_level", { threadId: caller.threadId }, seed).catch(() => null);
      facts.askLevel = l?.status === "ok" ? ((l.output as { level?: McpCaller["askLevel"] } | null)?.level ?? null) : null;
    }
    // a chat that builds a connector lists the builder's tools from the start: the CLI cannot pick up a tool found later with tool_search. A plain chat lists the crew tools and the reads
    // that check this Space before the agent says what Vyre can do here (lib/about-vyre.ts).
    const preload = typeof thread?.title === "string" && CONNECTOR_CHAT.test(thread.title) ? { preload: CONNECTOR_TOOLS } : typeof thread?.title === "string" && CRM_CHAT.test(thread.title) ? { preload: CRM_TOOLS } : thread?.kind === "chat" ? { preload: [...CREW_TOOLS, ...ABOUT_VYRE_TOOLS] } : {};
    // the owner's floor on the terminal: a local tool in this session follows the chat's mode up to it
    const setting = await o.invoke("settings.get", { key: "security.terminal_mode" }, { space: o.space, principal: caller.principal, ...(caller.actingFor ? { actingFor: caller.actingFor } : {}), origin: "mcp" }).catch(() => null);
    const row = setting?.status === "ok" ? (setting.output as { row?: { value?: unknown; floor?: unknown } } | null)?.row : undefined;
    if (row) caller = { ...caller, localFloor: modePair(row, o.space) };
    if (mode === "ask" || mode === "auto" || mode === "plan") return { ...caller, ...facts, mode, planMode: mode === "plan", ...preload };
    if ("preload" in preload || facts.threadKind !== undefined) return { ...caller, ...facts, ...preload };
  } catch { /* the chat is not readable here: no mode is applied */ }
  return caller;
}

export interface OauthRequest { method: string; path: string; search: string; headers: Readonly<Record<string, string | undefined>>; body: string; origin: string | null; visitor: string }
export interface McpRuntimeServer extends McpServer {
  /** A request to the sign-in addresses, or null when the path is not one of them. */
  oauth(req: OauthRequest): Promise<{ status: number; headers: Record<string, string>; body: string } | null>;
}

const STEP_MS = 1500;
const SEEN_MS = 15_000;
const KEEP_ACTIVITY = 1000;
const MAX_STEP_BLOCKS = 18;
/** Tools that are the work itself in a chat, or that only look around: a step line for them says nothing the chat does not show. */
const NO_STEP: ReadonlySet<string> = new Set(["chat.post", "agents.next", "mcp.tool.search", "mcp.tool.describe", "mcp.tools.list", "mcp.toolsets.list"]);

/** One outside agent's unfinished line in a chat: its steps gather for a moment and post as one message, the way a turn's steps sit together. */
interface Steps { threadId: string; caller: McpCaller; blocks: Array<{ type: string; v: number; data: unknown }>; timer: ReturnType<typeof setTimeout> | null }

const formOf = (body: string): Record<string, string | undefined> | null => {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) { if (k in out) return null; out[k] = v; }   // a parameter sent twice is refused (RFC 6749 3.2)
  return out;
};

/** The MCP server on this host's tables. Binds itself so mcp.session.close also ends the live session. */
export function createMcpRuntime(o: RuntimeOptions): McpRuntimeServer {
  const now = o.now ?? Date.now;
  ensure(o.db);
  if (o.endpoint) bindEndpoint(o.endpoint);
  const g = loadGenerated();
  const lastSeen = new Map<string, number>();
  const steps = new Map<string, Steps>();

  const flush = (sessionId: string): Promise<void> => {
    const s = steps.get(sessionId);
    if (!s) return Promise.resolve();
    if (s.timer) clearTimeout(s.timer);
    steps.delete(sessionId);
    if (s.blocks.length === 0) return Promise.resolve();
    const seed = { space: o.space, principal: s.caller.principal, ...(s.caller.actingFor ? { actingFor: s.caller.actingFor } : {}), thread: s.threadId, origin: "mcp" as const };
    return o.invoke("chat.post", { threadId: s.threadId, body: "", blocks: s.blocks, idempotencyKey: mintId("stp", now()) }, seed).then(() => undefined, () => undefined);
  };

  function noteStep(caller: McpCaller, tool: string, outcome: "ok" | "error" | "held", detail: NonNullable<Parameters<NonNullable<McpServerDeps["onCall"]>>[3]>): void {
    const threadId = detail.threadId;
    if (!threadId?.startsWith("thr_")) return;
    if (detail.cap === "chat.post") { void flush(caller.sessionId); return; }
    const open = steps.get(caller.sessionId);
    if (open && open.threadId !== threadId) void flush(caller.sessionId);
    const s = steps.get(caller.sessionId) ?? { threadId, caller, blocks: [], timer: null };
    steps.set(caller.sessionId, s);
    if (!NO_STEP.has(detail.cap)) {
      const id = mintId("cal", now());
      s.blocks.push({ type: "tool_call", v: 1, data: { id, name: tool } }, { type: "tool_result", v: 1, data: { id, ok: outcome === "ok" } });
    }
    if (detail.card) s.blocks.push({ type: "link_card", v: 1, data: { icon: detail.card.icon, lead: detail.card.lead, title: detail.card.title, target: detail.card.target, ...(detail.card.via ? { via: detail.card.via } : {}) } });
    if (s.blocks.length >= MAX_STEP_BLOCKS) { void flush(caller.sessionId); return; }
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => { void flush(caller.sessionId); }, STEP_MS);
    (s.timer as { unref?: () => void }).unref?.();
  }

  function noteOutside(caller: McpCaller, tool: string, outcome: "ok" | "error" | "held", detail: NonNullable<Parameters<NonNullable<McpServerDeps["onCall"]>>[3]>): void {
    const at = now();
    const threadId = detail.threadId?.startsWith("thr_") ? detail.threadId : null;
    o.db.run("INSERT INTO mcp_activity (id, agent_id, person, tool, cap, outcome, thread_id, task_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", mintId("mca", at), caller.principal.id, caller.actingFor ?? "", tool, detail.cap, outcome, threadId, detail.taskId ?? null, at);
    if (at - (lastSeen.get(caller.principal.id) ?? 0) >= SEEN_MS) {
      lastSeen.set(caller.principal.id, at);
      o.db.run("DELETE FROM mcp_activity WHERE agent_id = ? AND id NOT IN (SELECT id FROM mcp_activity WHERE agent_id = ? ORDER BY at DESC LIMIT ?)", caller.principal.id, caller.principal.id, KEEP_ACTIVITY);
      void o.system?.("agents.outside.seen", { agentId: caller.principal.id }).catch(() => undefined);
    }
    noteStep(caller, tool, outcome, detail);
  }

  /** An outside agent's access token, on every request. One sign-in keeps one session across rotated tokens, so the client's session id goes on working. */
  function outside(token: string, clientName: string | undefined, origin: string | undefined): McpCaller | null {
    const grant = grantForAccess(o.db, token, origin, now());
    if (!grant || !o.active?.(grant.agentId, grant.person)) return null;
    let s = grant.sessionId ? sessionBy(o.db, "session_id", grant.sessionId) : null;
    if (!s || s.closedAt !== undefined) {
      const at = now();
      s = { sessionId: mintId("ses", at), kind: "outside", principal: grant.agentId, actingFor: grant.person, name: (clientName ?? grant.clientName).slice(0, 120), startedAt: at, calls: 0 };
      insertSession(o.db, s);
      o.db.run("UPDATE mcp_oauth_grants SET session_id = ? WHERE grant_id = ?", s.sessionId, grant.grantId);
    }
    return outsideCaller(o.space, s, grant.resource);
  }

  const server = createMcpServer({
    catalog: g.catalog,
    defaults: g.defaults,
    invoke: o.invoke,
    now,
    ...(o.info ? { info: o.info } : {}),
    ...(o.allowedOrigins ? { allowedOrigins: o.allowedOrigins } : {}),
    challenge,
    async open(token, clientName, origin) {
      const out = outside(token, clientName, origin);
      if (out) return out;
      const r = await driverForToken(o.db, o.space, token, now());
      if ("refused" in r) return null;
      return withChatMode(o, r.caller);
    },
    async stillValid(caller) {
      const s = sessionBy(o.db, "session_id", caller.sessionId);
      return s !== null && isLive(o.db, s, now());
    },
    onCall(caller, tool, outcome, detail) {
      touchSession(o.db, caller.sessionId, now());
      // the call is done and on the audit log: a row that cannot be written must not turn its answer into an error
      if (caller.kind === "outside" && detail) { try { noteOutside(caller, tool, outcome, detail); } catch { /* the activity list misses one row */ } }
      // a CLI engine's work shows under its reply as cards, as it does on an API driver: a task, a file, and a send waiting on a yes
      else if (detail?.card && detail.threadId) recordWork(sessionWorkKey(detail.threadId, caller.principal.id), detail.card);
    },
    async bindThread(caller, threadId) {
      const read = await withChatMode(o, { ...caller, kind: "driver", threadId });
      return { ...(read.mode ? { mode: read.mode } : {}), ...(read.planMode ? { planMode: true } : {}), ...(read.threadKind ? { threadKind: read.threadKind } : {}), ...(read.scope ? { scope: read.scope } : {}) };
    },
    onClose(caller) { void flush(caller.sessionId); o.db.run("UPDATE mcp_sessions SET closed_at = ? WHERE session_id = ? AND closed_at IS NULL", now(), caller.sessionId); },
  });
  bindServer(server);

  const limits = { register: createLimiter(20, now), authorize: createLimiter(60, now), token: createLimiter(120, now), wait: createLimiter(120, now) };
  const JSON_NO_STORE = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" };
  const send = (status: number, body: unknown, headers: Record<string, string> = {}): { status: number; headers: Record<string, string>; body: string } => ({ status, headers: { ...JSON_NO_STORE, ...headers }, body: JSON.stringify(body) });
  const oauthError = (status: number, error: string, description?: string) => send(status, { error, ...(description ? { error_description: description } : {}) });
  const slow = () => oauthError(429, "slow_down", "Too many requests. Try again in a minute.");

  async function oauth(req: OauthRequest): ReturnType<McpRuntimeServer["oauth"]> {
    const paths = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/oauth/register", "/oauth/authorize", "/oauth/token", "/oauth/wait"];
    if (!paths.includes(req.path)) return null;
    const origin = req.origin;
    if (origin === null) return oauthError(404, "not_found", "This Space has no address to sign in at.");
    const at = now();
    if (req.method === "OPTIONS") return { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization, mcp-protocol-version", "access-control-max-age": "600" }, body: "" };
    if (req.path.startsWith("/.well-known/oauth-protected-resource")) return req.method === "GET" ? send(200, protectedResource(origin)) : oauthError(405, "method_not_allowed");
    if (req.path === "/.well-known/oauth-authorization-server") return req.method === "GET" ? send(200, serverMetadata(origin)) : oauthError(405, "method_not_allowed");
    if (req.path === "/oauth/register") {
      if (req.method !== "POST") return oauthError(405, "method_not_allowed");
      if (!limits.register(req.visitor)) return slow();
      let body: unknown;
      try { body = JSON.parse(req.body); } catch { return oauthError(400, "invalid_client_metadata", "That is not JSON."); }
      const r = registerClient(o.db, body, at);
      return "client" in r ? send(201, r.client) : oauthError(400, r.error, r.description);
    }
    if (req.path === "/oauth/authorize") {
      if (req.method !== "GET") return oauthError(405, "method_not_allowed");
      if (!limits.authorize(req.visitor)) { const page = refusalPage("Too many requests", "Try again in a minute."); return { status: 429, headers: { ...page.headers }, body: page.body }; }
      const q: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(req.search)) { if (k in q) { const page = refusalPage("This link is not valid", "Start again from the app you are connecting."); return { status: 400, headers: { ...page.headers }, body: page.body }; } q[k] = v; }
      const begun = beginAuthorize(o.db, q, origin, at);
      if (begun.kind === "refuse") { const page = refusalPage(begun.title, begun.text); return { status: 400, headers: { ...page.headers }, body: page.body }; }
      if (begun.kind === "redirect") return { status: 302, headers: { location: begun.to, "cache-control": "no-store" }, body: "" };
      const page = allowTab({ clientName: begun.client.name, spaceName: (await o.spaceName?.().catch(() => undefined)) ?? "this Space", match: begun.request.match, requestId: begun.request.requestId, proof: begun.proof, origin, ...(begun.redirectHost ? { redirectHost: begun.redirectHost } : {}), ...(o.webApp ? { webApp: o.webApp } : {}) });
      return { status: 200, headers: { ...page.headers }, body: page.body };
    }
    if (req.path === "/oauth/wait") {
      if (req.method !== "POST") return oauthError(405, "method_not_allowed");
      if (!limits.wait(req.visitor)) return slow();
      let b: { request?: unknown; proof?: unknown } = {};
      try { b = JSON.parse(req.body) as typeof b; } catch { return oauthError(400, "invalid_request"); }
      const w = typeof b.request === "string" && typeof b.proof === "string" ? collect(o.db, b.request, b.proof, origin, at) : null;
      return w ? send(200, w) : oauthError(404, "invalid_request");
    }
    if (req.method !== "POST") return oauthError(405, "method_not_allowed");
    if (!limits.token(req.visitor)) return slow();
    if (!/^application\/x-www-form-urlencoded\b/i.test(req.headers["content-type"] ?? "")) return oauthError(400, "invalid_request", "Send the form as application/x-www-form-urlencoded.");
    const form = formOf(req.body);
    if (!form) return oauthError(400, "invalid_request", "A parameter was sent twice.");
    const r = exchange(o.db, form, origin, at);
    if ("tokens" in r) return send(200, r.tokens);
    if (r.ended) boundServer()?.end(r.ended);
    if (r.replayed) void o.system?.("mcp.oauth.replayed", { agentId: r.replayed.agentId, person: r.replayed.person, why: "A used sign-in came back" }).catch(() => undefined);
    return oauthError(r.error === "invalid_client" ? 401 : 400, r.error, r.description);
  }

  return Object.assign(server, { oauth });
}

/** The module's own reading of the event log. */
export const consumers = {
  /** An agent went to Trash, whatever the way: its sign-in ends with it. */
  "mcp.agent_gone": { on: ["agent.deleted"], run: (ctx: McpCtx, event: { payload: { agentId?: unknown } }): string[] => onAgentDeleted(ctx, event) },
  /** A person answered a call an outside agent was held on. */
  "mcp.hold_answered": { on: ["gate.approved", "gate.denied", "gate.expired"], run: (ctx: OauthCtx, event: { name: string; payload: { taskId?: unknown; mode?: unknown; note?: unknown } }): Promise<string[]> => onHoldAnswered(ctx, event) },
};

export { bindEndpoint, bindServer };
