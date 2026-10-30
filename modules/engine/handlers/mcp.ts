// engine: outside MCP tools (CHAT-DESIGN ruling 6). `plugins.mcp.servers` says which servers a chat with an agent connects to; these capabilities start them in the sandbox, list their tools and call
// them. Every call is one capability, so the caller's access, the Gate (an agent's call that may change things is held for the asker unless a rule allows it) and the audit trail apply.
import { actorOf, raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";
import { pluginRuntime } from "../plugin-host.ts";
import { PluginError } from "../plugin-runtime.ts";
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
      out.push({ key: spec.key, name: spec.name, from: spec.from, ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, readOnly: t.readOnly })) });
    } catch (e) {
      out.push({ key: spec.key, name: spec.name, from: spec.from, ok: false, error: e instanceof Error ? e.message : "The server did not answer.", tools: [] });
    }
  }
  return { servers: out };
}

export async function mcpCall(ctx: EngineCtx, input: { agentId: string; server: string; tool: string; input?: unknown }) {
  const spec = (await servers(ctx, input.agentId)).find((s) => s.key === input.server);
  if (!spec) raise(ctx, "validation.not_found", `This agent has no outside tool server called ${input.server}.`);
  try {
    const r = await rt(ctx).callTool(spec, { agentId: input.agentId, asker: actorOf(ctx) }, input.tool, input.input ?? {});
    return { isError: r.isError, text: r.text, ...(r.structured !== undefined ? { structured: r.structured } : {}) };
  } catch (e) { return asError(ctx, e); }
}
