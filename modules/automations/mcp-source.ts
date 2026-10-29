// An MCP address is a connector source. Each tool name becomes one drafted action.
// The document is data. It is parsed. A description is not an action, and a URL inside it is not opened.

import { actionsFromMcpTools } from "./connector-breadth.ts";
import type { McpTool, NamedAction } from "./connector-breadth.ts";
import { fetchPublicDocument } from "./public-fetch.ts";
import type { FetchDeps } from "./public-fetch.ts";

const NO_TOOLS = "That document has no tools.";

type McpActions =
  | { ok: true; actions: NamedAction[] }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function asTool(value: unknown): McpTool | null {
  if (!isRecord(value)) return null;
  const name = own(value, "name");
  if (typeof name !== "string") return null;
  const description = own(value, "description");
  if (typeof description === "string") return { name, description };
  return { name };
}

function toolList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return null;
  const listed = own(value, "tools");
  if (Array.isArray(listed)) return listed;
  if (listed !== undefined) return null;
  const result = own(value, "result");
  if (!isRecord(result)) return null;
  const nested = own(result, "tools");
  return Array.isArray(nested) ? nested : null;
}

function toolsFrom(value: unknown): McpTool[] | null {
  const list = toolList(value);
  if (!list) return null;
  const tools: McpTool[] = [];
  for (const item of list) {
    const tool = asTool(item);
    if (tool) tools.push(tool);
  }
  return tools;
}

/** Turn a tools list, a result.tools list, or a bare tool array into drafted actions. */
export function actionsFromMcpDocument(app: string, text: string): McpActions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: NO_TOOLS };
  }
  const tools = toolsFrom(parsed);
  if (!tools) return { ok: false, reason: NO_TOOLS };
  const actions = actionsFromMcpTools(app, tools);
  if (actions.length === 0) return { ok: false, reason: NO_TOOLS };
  return { ok: true, actions };
}

/** Fetch one public MCP document and draft an action for each tool name. */
export async function mcpActionsFromUrl(app: string, url: string, deps: FetchDeps): Promise<McpActions> {
  const fetched = await fetchPublicDocument(url, deps);
  if (!fetched.ok) return { ok: false, reason: fetched.reason };
  return actionsFromMcpDocument(app, fetched.text);
}
