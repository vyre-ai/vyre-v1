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
      await watchConnection(spec, "ok");
      out.push({ key: spec.key, name: spec.name, from: spec.from, ...(spec.hub ? { hub: spec.hub as "composio" | "pipedream" } : {}), ...(spec.oauth ? { oauth: true } : {}), ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, readOnly: t.readOnly })) });
    } catch (e) {
      await watchConnection(spec, { error: e instanceof Error ? e.message : "" });
      out.push({ key: spec.key, name: spec.name, from: spec.from, ...(spec.hub ? { hub: spec.hub as "composio" | "pipedream" } : {}), ...(spec.oauth ? { oauth: true } : {}), ok: false, error: e instanceof Error ? e.message : "The server did not answer.", tools: [] });
    }
  }
  return { servers: out };
}

export async function mcpCall(ctx: EngineCtx, input: { agentId: string; server: string; tool: string; input?: unknown }) {
  const spec = (await servers(ctx, input.agentId)).find((s) => s.key === input.server);
  if (!spec) raise(ctx, "validation.not_found", `This agent has no outside tool server called ${input.server}.`);
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

/** The address to send the person to. Whoever manages connections may start it; the token that comes back is sealed and never answered. */
export async function mcpOauthStart(ctx: EngineCtx, input: { connectionId: string; redirectUri: string }): Promise<{ authUrl: string; state: string }> {
  const o = oauth(ctx);
  const conn = ((await ctx.call("plugins.connections.list", {})) as { connections: { connectionId: string; url?: string; auth?: string }[] }).connections.find((c) => c.connectionId === input.connectionId);
  if (!conn || !conn.url) raise(ctx, "validation.not_found", "There is no such remote connection.");
  if (conn.auth !== "oauth") raise(ctx, "validation.precondition_failed", "This connection does not sign in with OAuth.");
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
