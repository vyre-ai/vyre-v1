// Tools for a chat on an API key (ARCH 6.7): the API driver advertises the same tool set the MCP endpoint offers this agent for this asker, and each call runs as one capability invoke through
// the host's pipeline, as the agent acting for the asker (agent/src/drivers/open/api-tools.ts). This builds that from the host's `invoke` and the generated catalog, the way the MCP module does.
// @reads /generated/registry.json
// @reads /generated/mcp-tools.json
// @reads /docs/frozen/agent-tools.md
import { readFileSync } from "node:fs";
import { createApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import type { ApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import { createToolSession } from "../../agent/src/tools/call.ts";
import { decideLocal } from "../../agent/src/tools/local.ts";
import { localFacts } from "../../agent/src/tools/local-facts.ts";
import type { SecurityMode } from "../../agent/src/tools/local.ts";
import { buildCatalog, parseDefaultTools } from "../../agent/src/tools/catalog.ts";
import type { AgentToolRow, McpToolRow, RegistryCapRow } from "../../agent/src/tools/types.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import type { AgentRules, Level, ThreadFacts } from "../../agent/src/tools/types.ts";
import type { CallHooks, DynamicTools } from "../../agent/src/tools/call.ts";
import type { ToolCtx, ToolDef } from "../../agent/src/tools/types.ts";
import type { SystemBlock } from "../../agent/src/drivers/api/types.ts";
import type { SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";

interface SettingRow { value?: unknown; floor?: unknown }
interface ModePair { person: SecurityMode; floor: SecurityMode }
const MODES: readonly string[] = ["ask", "allow", "auto"];
const asMode = (v: unknown): SecurityMode | undefined => (typeof v === "string" && MODES.includes(v) ? (v as SecurityMode) : undefined);
/** A mode setting is { base, spaces: { <space>: mode } } (or a bare mode, as a floor may be). The person's mode here is this Space's entry, else the base; no floor means anyone may pick Auto; nothing readable means Ask. */
export function modePair(row: SettingRow | undefined, space: string): ModePair {
  if (!row) return { person: "ask", floor: "ask" };
  const pick = (v: unknown): SecurityMode | undefined => {
    if (asMode(v)) return asMode(v);
    const o = (v !== null && typeof v === "object" ? v : {}) as { base?: unknown; spaces?: Record<string, unknown> };
    return asMode(o.spaces?.[space]) ?? asMode(o.base);
  };
  return { person: pick(row.value) ?? "ask", floor: row.floor === undefined ? "auto" : pick(row.floor) ?? "ask" };
}

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

export interface EngineApiToolsDeps {
  invoke: Invoke;
  space: string;
  /** The agent's role as system prompt blocks. */
  system(spec: SessionSpec, input: TurnInput): Promise<SystemBlock[]>;
  /** Call a capability as a person: what the tool set of a turn depends on is read this way, before the turn's tools are chosen. */
  call?(cap: string, input: unknown, as?: string): Promise<unknown>;
  /** The MCP tools of the agent's plugins and connections, and the plugin hooks around every call (modules/engine/plugin-tools.ts). */
  plugins?: { extra(ctx: ToolCtx): Promise<ToolDef[]>; dynamic: DynamicTools; hooks: CallHooks };
}

let catalog: ReturnType<typeof buildCatalog> | null = null;
let defaults: Set<string> | null = null;

export function createEngineApiTools(d: EngineApiToolsDeps): ApiTools {
  if (!catalog || !defaults) {
    const reg = JSON.parse(read("generated/registry.json")) as { capabilities: RegistryCapRow[]; agentTools: AgentToolRow[] };
    const tools = (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools;
    catalog = buildCatalog(reg.capabilities, tools, reg.agentTools);
    defaults = parseDefaultTools(read("docs/frozen/agent-tools.md"));
  }
  // What decides a turn's tool set is read as the asker before the set is built (the tool session asks synchronously): the agent's allow and deny lists, what the thread is (an Ask pane about an object,
  // plan mode), and the asker's level on that object. An Ask pane never offers more than the asker holds on what it is about.
  const rules = new Map<string, AgentRules>();
  const facts = new Map<string, Omit<ThreadFacts, "threadId">>();
  const levels = new Map<string, Level | null>();
  const modes = new Map<string, { terminal: ModePair; chrome: ModePair }>();
  const levelKey = (asker: string, scope: { type: string; id: string }): string => `${asker}|${scope.type}|${scope.id}`;
  const session = createToolSession({ invoke: d.invoke, catalog, defaults, levelFor: (asker, scope) => levels.get(levelKey(asker, scope)) ?? null, canEngineer: () => false,
    // A local tool (terminal, Chrome, screen, files on the agent computer) follows the person's own security mode for it (Settings, This computer: Terminal prompts, Chrome prompts), held to the owner's floor,
    // with the hard walls of the call itself (a path that leaves the work folder is refused, a delete outside it always asks). A "prompt" is not a refusal and not a silent run: the call is held at the Gate and
    // the person answers it in the chat. Settings are read as the asker before the turn (the tool session asks synchronously); one that cannot be read means the strictest mode.
    localPolicy: (t, ctx, input) => {
      const m = modes.get(ctx.asker);
      const one = t.local === "chrome" || t.local === "screen" ? m?.chrome : m?.terminal;
      return decideLocal(t, one?.person ?? "ask", one?.floor ?? "ask", localFacts(t, input));
    },
    ...(d.plugins ? { dynamic: d.plugins.dynamic, hooks: d.plugins.hooks } : {}) });
  const primed = new Set<string>();
  const prepare = async (t: { threadId: string; agentId: string; asker: string; turnId: string }): Promise<void> => {
    if (!d.call || primed.has(t.turnId)) return;
    primed.add(t.turnId);
    if (primed.size > 500) primed.delete(primed.values().next().value as string);
    const [agent, thread] = await Promise.all([
      d.call("agents.get", { agentId: t.agentId }, t.asker).catch(() => undefined) as Promise<{ agent?: { toolsAllowed?: string[]; toolsDenied?: string[] } } | undefined>,
      d.call("threads.get", { threadId: t.threadId }, t.asker).catch(() => undefined) as Promise<{ thread?: { kind?: ThreadFacts["kind"]; planMode?: boolean; mode?: ThreadFacts["mode"]; scopeType?: string; scopeId?: string } } | undefined>,
    ]);
    const [terminalMode, chromeMode] = await Promise.all(["security.terminal_mode", "security.chrome_mode"].map((key) => d.call!("settings.get", { key }, t.asker).catch(() => undefined) as Promise<{ row?: SettingRow } | undefined>));
    modes.set(t.asker, { terminal: modePair(terminalMode?.row, d.space), chrome: modePair(chromeMode?.row, d.space) });
    const a = agent?.agent;
    rules.set(t.agentId, { ...(a?.toolsAllowed?.length ? { allow: a.toolsAllowed } : {}), ...(a?.toolsDenied?.length ? { deny: a.toolsDenied } : {}) });
    const th = thread?.thread;
    const scope = th?.scopeType && th.scopeId ? { type: th.scopeType, id: th.scopeId } : undefined;
    facts.set(t.threadId, { kind: th?.kind ?? "chat", planMode: th?.planMode === true, ...(th?.mode === "ask" || th?.mode === "auto" || th?.mode === "plan" ? { mode: th.mode } : {}), ...(scope ? { scope } : {}) });
    if (th?.kind === "ask" && scope) {
      const lvl = await d.call("chat.ask_level", { threadId: t.threadId }, t.asker).catch(() => undefined) as { level?: Level | null } | undefined;
      levels.set(levelKey(t.asker, scope), lvl?.level ?? null);
    }
  };
  const tools = createApiTools({ session, space: d.space, system: (spec, input) => d.system(spec, input), prepare, rules: (id) => rules.get(id), thread: (id) => facts.get(id), ...(d.plugins ? { extra: d.plugins.extra } : {}) });
  return tools;
}
