// Tools for a chat on an API key (ARCH 6.7): the API driver advertises the same tool set the MCP endpoint offers this agent for this asker, and each call runs as one capability invoke through
// the host's pipeline, as the agent acting for the asker (agent/src/drivers/open/api-tools.ts). This builds that from the host's `invoke` and the generated catalog, the way the MCP module does.
// @reads /generated/registry.json
// @reads /generated/mcp-tools.json
// @reads /docs/frozen/agent-tools.md
import { readFileSync } from "node:fs";
import { createApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import type { ApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import { createToolSession } from "../../agent/src/tools/call.ts";
import { buildCatalog, parseDefaultTools } from "../../agent/src/tools/catalog.ts";
import type { AgentToolRow, McpToolRow, RegistryCapRow } from "../../agent/src/tools/types.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import type { CallHooks, DynamicTools } from "../../agent/src/tools/call.ts";
import type { ToolCtx, ToolDef } from "../../agent/src/tools/types.ts";
import type { SystemBlock } from "../../agent/src/drivers/api/types.ts";
import type { SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

export interface EngineApiToolsDeps {
  invoke: Invoke;
  space: string;
  /** The agent's role as system prompt blocks. */
  system(spec: SessionSpec, input: TurnInput): Promise<SystemBlock[]>;
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
  // An Ask pane's scope level is not offered yet (the MCP endpoint answers the same): such a thread gets the narrowest set.
  const session = createToolSession({ invoke: d.invoke, catalog, defaults, levelFor: () => null, canEngineer: () => false, ...(d.plugins ? { dynamic: d.plugins.dynamic, hooks: d.plugins.hooks } : {}) });
  return createApiTools({ session, space: d.space, system: (spec, input) => d.system(spec, input), ...(d.plugins ? { extra: d.plugins.extra } : {}) });
}
