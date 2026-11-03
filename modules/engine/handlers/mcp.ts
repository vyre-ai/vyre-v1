// engine: outside MCP tools (CHAT-DESIGN ruling 6). `plugins.mcp.servers` says which servers a chat with an agent connects to; these capabilities start them in the sandbox, list their tools and call
// them. Every call is one capability, so the caller's access, the Gate (an agent's call that may change things is held for the asker unless a rule allows it) and the audit trail apply.
import { actorOf, raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import { mcpOauth, pluginRuntime } from "../plugin-host.ts";
import { OauthError, bindOauthStore } from "../mcp-oauth.ts";
import { PluginError } from "../plugin-runtime.ts";
import { watchConnection } from "../connection-watch.ts";
import type { ServerSpec } from "../plugin-runtime.ts";

const rt = (ctx: EngineCtx) => pluginRuntime() ?? raise(ctx, "provider.unavailable", "Outside tools cannot run on this server: there is no sandbox to run them in.");
const asError = (ctx: EngineCtx, e: unknown): never => {
  if (e instanceof PluginError) return raise(ctx, e.code, e.message);
  throw e;
};

async function servers(ctx: EngineCtx, agentId: string): Promise<ServerSpec[]> {
  return ((await ctx.call("plugins.mcp.servers", { agentId })) as { servers: ServerSpec[] }).servers;
}

export async function mcpTools(ctx: EngineCtx, input: { agentId: string; server?: string }) {
  const list = (await servers(ctx, input.agentId)).filter((s) => input.server === undefined || s.key === input.server);
  const runtime = rt(ctx);
  const out = [];
  for (const spec of list) {
    try {
      const tools = await runtime.tools(spec, { agentId: input.agentId, asker: actorOf(ctx) });
      await watchConnection(spec, "ok", tools.length);
      out.push({ key: spec.key, name: spec.name, from: spec.from, ...(spec.hub ? { hub: spec.hub as "composio" | "pipedream" } : {}), ...(spec.oauth ? { oauth: true } : {}), ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, readOnly: t.readOnly })) });
    } catch (e) {
      await watchConnection(spec, { error: e instanceof Error ? e.message : "" });
      out.push({ key: spec.key, name: spec.name, from: spec.from, ...(spec.hub ? { hub: spec.hub as "composio" | "pipedream" } : {}), ...(spec.oauth ? { oauth: true } : {}), ok: false, error: e instanceof Error ? e.message : "The server did not answer.", tools: [] });
    }
  }
  return { servers: out };
}

/** An agent calls the outside tools of the agent it is: a call naming another agent's servers is refused. A person (or the host) may name any agent they can see, as before. */
function ownAgent(ctx: EngineCtx, agentId: string): void {
  if (ctx.principal.kind === "agent" && ctx.principal.id !== agentId) raise(ctx, "permission.no_grant", "An agent calls its own outside tools: use your own agentId.");
}

/** Which tools of a server only read, as the server last said; kept a minute so a read is not two round trips. */
const READ_ONLY_MS = 60_000;
const readOnlyCache = new Map<string, { at: number; tools: Map<string, boolean> }>();
async function readOnlyTool(ctx: EngineCtx, spec: ServerSpec, agentId: string, tool: string): Promise<boolean | undefined> {
  const key = `${spec.key}|${agentId}|${actorOf(ctx)}`;
  const hit = readOnlyCache.get(key);
  if (hit && Date.now() - hit.at < READ_ONLY_MS && hit.tools.has(tool)) return hit.tools.get(tool);
  const listed = await rt(ctx).tools(spec, { agentId, asker: actorOf(ctx) });
  const tools = new Map(listed.map((t) => [t.name, t.readOnly === true] as const));
  readOnlyCache.set(key, { at: Date.now(), tools });
  return tools.get(tool);
}

/**
 * engine.mcp.read: the same call, for a tool the server says only reads. It skips the Gate, so it checks that itself: a tool the server does not mark read-only is refused here and goes through
 * engine.mcp.call (mcp_call), which waits at the Gate for an agent. An API model reaches this through its mcp__<server>__<tool> tools; a CLI engine through mcp_read on Vyre's MCP.
 */
export async function mcpRead(ctx: EngineCtx, input: { agentId: string; server: string; tool: string; input?: unknown }) {
  ownAgent(ctx, input.agentId);
  const spec = (await servers(ctx, input.agentId)).find((s) => s.key === input.server);
  if (!spec) raise(ctx, "validation.not_found", `This agent has no outside tool server called ${input.server}.`);
  let readOnly: boolean | undefined;
  try { readOnly = await readOnlyTool(ctx, spec!, input.agentId, input.tool); } catch (e) { await watchConnection(spec!, { error: e instanceof Error ? e.message : "" }); return asError(ctx, e); }
  if (readOnly === undefined) raise(ctx, "validation.not_found", `${input.server} has no tool called ${input.tool}. mcp_tools lists them.`);
  if (!readOnly) raise(ctx, "validation.precondition_failed", `${input.tool} may change things, so it is not a read: call it with mcp_call.`);
  return callOn(ctx, spec!, input);
}

/** engine.mcp.call: one tool call at an outside server, as the person asking. An agent's call has passed the Gate (the capability's gate) before it gets here. */
export async function mcpCall(ctx: EngineCtx, input: { agentId: string; server: string; tool: string; input?: unknown }) {
  ownAgent(ctx, input.agentId);
  const spec = (await servers(ctx, input.agentId)).find((s) => s.key === input.server);
  if (!spec) raise(ctx, "validation.not_found", `This agent has no outside tool server called ${input.server}.`);
  return callOn(ctx, spec!, input);
}

async function callOn(ctx: EngineCtx, spec: ServerSpec, input: { agentId: string; tool: string; input?: unknown }) {
  try {
    const r = await rt(ctx).callTool(spec, { agentId: input.agentId, asker: actorOf(ctx) }, input.tool, input.input ?? {});
    await watchConnection(spec, r.isError && /answered 401/.test(r.text) ? { error: r.text } : "ok");
    return { isError: r.isError, text: r.text, ...(r.structured !== undefined ? { structured: r.structured } : {}) };
  } catch (e) { await watchConnection(spec, { error: e instanceof Error ? e.message : "" }); return asError(ctx, e); }
}

// ---- signing in to a remote server with OAuth

const oauth = (ctx: EngineCtx) => { bindOauthStore(ctx as never); return mcpOauth() ?? raise(ctx, "provider.unavailable", "Outside tools cannot sign in on this server: there is no way to reach them."); };
const asOauthError = (ctx: EngineCtx, e: unknown): never => {
  if (e instanceof OauthError) return raise(ctx, e.code, e.message);
  throw e;
};

/** The address to send the person to. A person signs their own (Mine) connection in; a Space or agent one is signed in by whoever manages connections. The token that comes back is sealed and never answered. */
export async function mcpOauthStart(ctx: EngineCtx, input: { connectionId: string; redirectUri: string }): Promise<{ authUrl: string; state: string }> {
  const o = oauth(ctx);
  const conn = ((await ctx.call("plugins.connections.list", {})) as { connections: { connectionId: string; url?: string; auth?: string; scope?: string }[] }).connections.find((c) => c.connectionId === input.connectionId);
  if (!conn || !conn.url) raise(ctx, "validation.not_found", "There is no such remote connection.");
  if (conn.auth !== "oauth") raise(ctx, "validation.precondition_failed", "This connection does not sign in with OAuth.");
  if (conn.scope !== "mine") {
    const home = (await ctx.call("plugins.connections.home", {})) as { space: { connectionId?: string; canManage: boolean }[]; agents: { connectionId?: string; canManage: boolean }[] };
    const row = [...home.space, ...home.agents].find((r) => r.connectionId === input.connectionId);
    if (!row?.canManage) raise(ctx, "permission.role_lacks_permission", "Only someone who manages agents signs a Space connection in.");
  }
  try { return await o.start({ connectionId: input.connectionId, url: conn.url!, redirectUri: input.redirectUri, by: actorOf(ctx) }); } catch (e) { return asOauthError(ctx, e); }
}

/** The sign-in came back: finish it as the person who started it. */
export async function mcpOauthComplete(ctx: EngineCtx, input: { state: string; code?: string; error?: string }): Promise<{ connectionId: string }> {
  const o = oauth(ctx);
  try { return await o.complete({ state: input.state, ...(input.code !== undefined ? { code: input.code } : {}), ...(input.error !== undefined ? { error: input.error } : {}), by: actorOf(ctx) }); } catch (e) { return asOauthError(ctx, e); }
}

/** Has this connection signed in? A yes or no; never the token. */
export async function mcpOauthStatus(ctx: EngineCtx, input: { connectionId: string }): Promise<{ signedIn: boolean }> {
  return { signedIn: oauth(ctx).signedIn(input.connectionId) };
}
