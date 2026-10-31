// The plugin runtime of this daemon (modules/engine/plugin-runtime.ts), built from the engine's host half the first time something needs it and closed with it. Without a data directory or a
// sandbox there is nowhere to confine plugin code, and the runtime does not exist: a plugin's server then answers "unavailable" and nothing runs.
import { engineHost, sandboxPlan } from "./runtime.ts";
import { createPluginRuntime } from "./plugin-runtime.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import type { FetchPort } from "../../agent/src/mcp-client/index.ts";
import { createMcpOauth } from "./mcp-oauth.ts";
import type { McpOauth } from "./mcp-oauth.ts";

let runtime: PluginRuntime | null = null;
let builtFor: unknown = null;
let oauthFor: McpOauth | null = null;

/** The OAuth half of outside tools (sign-in start and finish, the sealed tokens), on the same network guard as the runtime. Null where there is no fetch to reach a server with. */
export function mcpOauth(): McpOauth | null {
  const h = engineHost();
  if (!h || !h.mcpFetch) return null;
  if (oauthFor && builtFor === h) return oauthFor;
  pluginRuntime();
  return oauthFor;
}

export function pluginRuntime(): PluginRuntime | null {
  const h = engineHost();
  if (!h) return null;
  if (runtime && builtFor === h) return runtime;
  const dataDir = h.sandbox?.dataDir ?? h.dataDir;
  if (!dataDir) return null;
  void runtime?.closeAll();
  const session = h.session;
  oauthFor = h.mcpFetch ? createMcpOauth({ fetch: h.mcpFetch as FetchPort }) : null;
  runtime = createPluginRuntime({
    call: h.call, plan: sandboxPlan, dataDir, ...(session ? { source: session.source, reportMiss: session.reportMiss } : {}),
    ...(h.mcpFetch ? { fetch: h.mcpFetch as FetchPort } : {}), ...(oauthFor ? { oauth: oauthFor } : {}), ...(h.pluginLaunch ? { launch: h.pluginLaunch as NonNullable<Parameters<typeof createPluginRuntime>[0]["launch"]> } : {}),
  });
  builtFor = h;
  return runtime;
}

export async function closePluginRuntime(): Promise<void> {
  const r = runtime;
  runtime = null;
  builtFor = null;
  await r?.closeAll().catch(() => undefined);
}
