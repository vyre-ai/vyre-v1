// The real session opener on a daemon (P-L2_23, with P-L2_23c): the host half hands plain ports (Vault lookup, loopback MCP, scrub-miss report); this builds agent/src/drivers/open's
// opener from them. A CLI engine (Claude Code, Codex, Grok) runs as a local process with the key filled into its environment and reaches Vyre over the loopback MCP endpoint, where the
// agent's tools run through the invoke pipeline. An API-key driver gets the agent's role as its system prompt and no tools yet: running its tools needs the engine's tool runner (callTool),
// which is a separate packet; until then a chat on an API key answers in words only.
import { createLocalLauncher } from "../../agent/src/drivers/cli/launcher.ts";
import { SandboxError } from "../../sandbox/src/index.ts";
import { openMcpBridge } from "./mcp-bridge.ts";
import { sandboxWrap, scratchFolder, workFolder } from "./sandbox.ts";
import type { SandboxPlan } from "./sandbox.ts";
import { createSessionOpener } from "../../agent/src/drivers/open/index.ts";
import type { McpPort, SessionOpener } from "../../agent/src/drivers/open/index.ts";
import type { ValueSource, VaultRunDeps } from "../../agent/src/vault-use/index.ts";
import type { SessionSpec } from "../../agent/src/turn-engine/types.ts";

/** The ports the host builds (host/src/seams/engine-session.ts), as the module sees them: structural, so neither side imports the other. */
export interface EngineSessionPorts { source: ValueSource; reportMiss: VaultRunDeps["reportMiss"]; mcp: McpPort }

export interface OpenerHost {
  session: EngineSessionPorts;
  /** Call a capability for a person; used for the agent's role. */
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  /** Where and how a CLI engine is sandboxed (the host decides). Without it a CLI turn fails with sandbox.unavailable: the engine never runs unwrapped. */
  sandbox?: SandboxPlan;
  now?: () => number;
}

/** Builds the opener; the runtime keeps it for the life of the daemon and calls close() on shutdown. */
export function buildOpener(h: OpenerHost): SessionOpener {
  const role = async (spec: SessionSpec): Promise<string> => {
    try {
      const out = (await h.call("agents.get", { agentId: spec.agent.id }, spec.asker)) as { agent?: { name?: string; role?: string } };
      const a = out.agent;
      return `You are ${a?.name ?? spec.agent.id}, an agent in Vyre.${a?.role ? ` ${a.role}` : ""}`;
    } catch {
      return `You are ${spec.agent.id}, an agent in Vyre.`;
    }
  };
  return createSessionOpener({
    source: h.session.source,
    reportMiss: h.session.reportMiss,
    mcp: h.session.mcp,
    launcher: h.sandbox
      ? createLocalLauncher({ wrap: sandboxWrap(h.sandbox) })
      : { spawn: () => Promise.reject(new SandboxError("sandbox.unavailable", "no sandbox is set up for CLI engines on this computer")) },
    // Behind the wall the engine cannot reach the daemon's loopback: its MCP config starts a stdio shim that talks to a unix socket in the person's scratch folder (ruling 61).
    ...(h.sandbox ? { mcpBridge: (m: { url: string; token: string }, spec: { asker: string }) => openMcpBridge(m, { scratch: scratchFolder(h.sandbox!.dataDir, spec.asker) }) } : {}),
    ...(h.sandbox ? { cli: { workFolder: (spec) => workFolder(h.sandbox!.dataDir, spec.asker, spec.threadId) } } : {}),
    apiContext: async (spec) => ({ system: [{ text: await role(spec), stable: true }], tools: [] }),
  });
}
