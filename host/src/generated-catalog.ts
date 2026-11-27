// The generated tool catalog, built once for the whole process (27 Nov 2026, the real-server guard): the engine module built it at start (230 to 260 ms in one stretch) and the MCP runtime built the very same one
// after the server listened (175 ms), each reading and parsing the 4 MB registry again. Here it is one: the registry the host already parsed, the tool list, the frozen default set, built with a turn of the loop
// between steps when the caller can wait (`warmGeneratedCatalog`), or in one go for a caller that cannot (`generatedCatalog`, as before). Whichever comes first is kept for both.
import { readFileSync } from "node:fs";
import { registry } from "../../generated/registry.ts";
import { buildCatalog, buildCatalogSliced, offerable, parseDefaultTools } from "../../agent/src/tools/catalog.ts";
import { DEFERRED_CAPS } from "./routes/deferred.ts";
import type { AgentToolRow, Catalog, McpToolRow, RegistryCapRow } from "../../agent/src/tools/types.ts";

export interface Generated {
  catalog: Catalog;
  defaults: Set<string>;
}
let built: Generated | null = null;
let building: Promise<Generated> | null = null;
const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

const inputs = (): { caps: RegistryCapRow[]; agentTools: AgentToolRow[]; tools: McpToolRow[]; defaults: Set<string> } => {
  const reg = registry as unknown as { capabilities: RegistryCapRow[]; agentTools: AgentToolRow[] };
  return {
    caps: reg.capabilities,
    agentTools: reg.agentTools,
    tools: (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools,
    defaults: parseDefaultTools(read("docs/frozen/agent-tools.md")),
  };
};

/** The catalog, built now in one stretch if nobody has built it yet. */
export function generatedCatalog(): Generated {
  if (built) return built;
  const i = inputs();
  built = { catalog: offerable(buildCatalog(i.caps, i.tools, i.agentTools), (cap) => DEFERRED_CAPS.has(cap)), defaults: i.defaults };
  return built;
}

/** The catalog, built with a turn of the loop between steps (`turn`); a caller that needed it meanwhile built it first, and this returns that one. */
export function warmGeneratedCatalog(turn: () => Promise<void>): Promise<Generated> {
  if (built) return Promise.resolve(built);
  building ??= (async () => {
    const i = inputs();
    await turn();
    const catalog = offerable(await buildCatalogSliced(i.caps, i.tools, i.agentTools, turn), (cap) => DEFERRED_CAPS.has(cap));
    built ??= { catalog, defaults: i.defaults };
    return built;
  })().finally(() => {
    building = null;
  });
  return building;
}

/** Has it been built (a turn would not pay for it)? */
export const generatedCatalogWarm = (): boolean => built !== null;
