// The MCP tools of plugins and connections, as tools for a chat on an API key (CHAT-DESIGN ruling 6): for an agent and the person asking, the servers `plugins.mcp.servers` names are started in the
// sandbox, their tools are listed to the model as mcp__<server>__<tool>, and a call is one engine.mcp.read or engine.mcp.call (read-only tools skip the Gate; the rest go through it). The hooks
// of those plugins run around every tool call, in the sandbox.
import { hubLine } from "../../lib/mcp-hubs.ts";
import type { CallHooks, DynamicTools } from "../../agent/src/tools/call.ts";
import type { ToolCtx, ToolDef } from "../../agent/src/tools/types.ts";
import type { HookSpec, PluginRuntime, ServerSpec } from "./plugin-runtime.ts";

export interface PluginToolsDeps {
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  runtime(): PluginRuntime | null;
  log?(msg: string, attrs?: Record<string, unknown>): void;
  now?: () => number;
}
interface Entry { def: ToolDef; server: string; tool: string; agentId: string }

/** A stable, non-cryptographic fingerprint (a key to deduplicate a retry, not a secret). */
const hash = (s: string): string => {
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) { a = ((a << 5) + a + s.charCodeAt(i)) >>> 0; b = ((b << 5) ^ b ^ s.charCodeAt(i)) >>> 0; }
  return `${a.toString(36)}${b.toString(36)}`;
};
const slug = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
/** mcp__<server>__<tool>, at most 64 characters (a model API limit): a long server part is cut and a short hash of the whole name keeps two long names apart. The tool part is kept. */
export function mcpToolName(server: string, tool: string): string {
  const sv = slug(server), tl = slug(tool);
  const full = `mcp__${sv}__${tl}`;
  if (full.length <= 64) return full;
  let h = 0;
  for (const ch of full) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tag = h.toString(36).slice(0, 5);
  const tail = tl.length > 36 ? tl.slice(0, 36) : tl;
  const room = Math.max(4, 64 - "mcp__".length - "_".length - tag.length - "__".length - tail.length);
  return `mcp__${sv.slice(0, room)}_${tag}__${tail}`;
}

/** A hook's matcher against a tool name: empty or * is every tool; anything else is a pattern that must match the whole name. */
export function matches(matcher: string, tool: string): boolean {
  if (matcher === "" || matcher === "*") return true;
  try { return new RegExp(`^(?:${matcher})$`).test(tool); } catch { return false; }
}

export function createPluginTools(d: PluginToolsDeps): { extra(ctx: ToolCtx): Promise<ToolDef[]>; dynamic: DynamicTools; hooks: CallHooks } {
  const now = d.now ?? Date.now;
  const byThread = new Map<string, Map<string, Entry>>();
  const hookCache = new Map<string, { at: number; hooks: HookSpec[] }>();

  const hooksFor = async (agentId: string, asker: string): Promise<HookSpec[]> => {
    const key = `${agentId}|${asker}`;
    const hit = hookCache.get(key);
    if (hit && now() - hit.at < 5_000) return hit.hooks;
    const hooks = ((await d.call("plugins.hooks.list", { agentId }, asker).catch(() => ({ hooks: [] }))) as { hooks: HookSpec[] }).hooks;
    hookCache.set(key, { at: now(), hooks });
    return hooks;
  };

  const run = async (event: string, ctx: ToolCtx, t: ToolDef, payload: Record<string, unknown>): Promise<Array<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>> => {
    const rt = d.runtime();
    if (!rt) return [];
    const hooks = (await hooksFor(ctx.agentId, ctx.asker)).filter((h) => h.event === event && matches(h.matcher, t.name));
    const out = [];
    for (const h of hooks) {
      try { out.push(await rt.runHook(h, { agentId: ctx.agentId, asker: ctx.asker }, { session_id: ctx.thread.threadId, hook_event_name: event, tool_name: t.name, ...payload })); }
      catch (e) { d.log?.("a plugin hook did not run", { plugin: h.plugin, event, error: e instanceof Error ? e.message : String(e) }); }
    }
    return out;
  };

  const list = async (ctx: ToolCtx): Promise<ToolDef[]> => {
      const rt = d.runtime();
      const mine = new Map<string, Entry>();
      byThread.set(ctx.thread.threadId, mine);
      if (!rt) return [];
      const servers = ((await d.call("plugins.mcp.servers", { agentId: ctx.agentId }, ctx.asker).catch(() => ({ servers: [] }))) as { servers: ServerSpec[] }).servers.filter((s) => s.needs.length === 0);
      const defs: ToolDef[] = [];
      await Promise.all(servers.map(async (spec) => {
        try {
          for (const tool of await rt.tools(spec, { agentId: ctx.agentId, asker: ctx.asker })) {
            const name = mcpToolName(spec.key, tool.name);
            const def: ToolDef = {
              name, cap: tool.readOnly ? "engine.mcp.read" : "engine.mcp.call", v: 1, toolset: "plugins", summary: `[${spec.name}] ${hubLine(spec.hub) ? `${hubLine(spec.hub)}. ` : ""}${tool.description}`.slice(0, 600), inputSchema: tool.inputSchema,
              effects: tool.readOnly ? "read" : "outward", planMode: tool.readOnly ? "allowed" : "blocked", level: "use", deferred: false, blocks: [], local: "none", gated: !tool.readOnly,
            };
            mine.set(name, { def, server: spec.key, tool: tool.name, agentId: ctx.agentId });
            defs.push(def);
          }
        } catch (e) { d.log?.("an outside tool server did not list its tools", { server: spec.key, error: e instanceof Error ? e.message : String(e) }); }
      }));
      return defs.sort((a, b) => a.name.localeCompare(b.name));
  };

  return {
    extra: list,
    dynamic: {
      find: async (ctx, name) => {
        const known = byThread.get(ctx.thread.threadId)?.get(name)?.def;
        if (known || !name.startsWith("mcp__")) return known;
        await list(ctx);   // this turn has not listed its tools yet (it resumed after a hold, or a restart)
        return byThread.get(ctx.thread.threadId)?.get(name)?.def;
      },
      input: (ctx, t, input) => {
        const e = byThread.get(ctx.thread.threadId)?.get(t.name);
        const body = { agentId: e?.agentId ?? ctx.agentId, server: e?.server ?? "", tool: e?.tool ?? "", input: input ?? {} };
        // A call that may change things carries an idempotency key. It comes from the turn and the call itself, so a call held at the Gate and resumed after approval is the same call (the approval is
        // bound to its payload), while the same words in another turn are a new one.
        return t.cap === "engine.mcp.call" ? { ...body, idempotencyKey: `mcp-${hash(`${ctx.thread.threadId}|${ctx.turnId ?? ""}|${t.name}|${JSON.stringify(body.input)}`)}` } : body;
      },
    },
    hooks: {
      async before(ctx, t, input) {
        for (const r of await run("PreToolUse", ctx, t, { tool_input: input })) {
          if (r.code === 2) return (r.stderr.trim() || r.stdout.trim() || "a plugin hook refused it").slice(0, 300);
        }
        return null;
      },
      async after(ctx, t, input, result) { await run("PostToolUse", ctx, t, { tool_input: input, tool_response: result.output }); },
    },
  };
}
