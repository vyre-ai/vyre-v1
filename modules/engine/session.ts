// The real session opener on a daemon (P-L2_23, with P-L2_23c): the host half hands plain ports (Vault lookup, loopback MCP, scrub-miss report); this builds agent/src/drivers/open's
// opener from them. A CLI engine (Claude Code, Codex, Grok) runs as a local process with the key filled into its environment and reaches Vyre over the loopback MCP endpoint, where the
// agent's tools run through the invoke pipeline. An API-key driver gets the agent's role as its system prompt and no tools yet: running its tools needs the engine's tool runner (callTool),
// which is a separate packet; until then a chat on an API key answers in words only.
import { createLocalLauncher } from "../../agent/src/drivers/cli/launcher.ts";
import { SandboxError } from "../../sandbox/src/index.ts";
import { openMcpBridge } from "./mcp-bridge.ts";
import { sandboxWrap, scratchFolder, workFolder } from "./sandbox.ts";
import type { SandboxPlan } from "./sandbox.ts";
import type { ApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import type { SystemBlock } from "../../agent/src/drivers/api/types.ts";
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
  /** The Space data directory (work folders live under it) and a builder for the default plan, used when the host gave none. Both come from the daemon. */
  dataDir?: string;
  defaultSandbox?: () => Promise<SandboxPlan>;
  /** Replace a CLI engine's program (argv[0], e.g. "claude") with a command, for a fake CLI in the booted test. Default: the real CLI. */
  cliCommand?: Readonly<Record<string, readonly string[]>>;
  /** Tools for API-key chats (modules/engine/api-tools.ts). Without them an API chat answers in words only. */
  apiTools?: ApiTools;
  now?: () => number;
}

export function roleBlocks(call: OpenerHost["call"]): (spec: SessionSpec) => Promise<SystemBlock[]> {
  return async (spec) => {
    let text: string;
    try {
      const out = (await call("agents.get", { agentId: spec.agent.id }, spec.asker)) as { agent?: { name?: string; role?: string } };
      const a = out.agent;
      text = `You are ${a?.name ?? spec.agent.id}, an agent in Vyre.${a?.role ? ` ${a.role}` : ""}`;
    } catch {
      text = `You are ${spec.agent.id}, an agent in Vyre.`;
    }
    return [{ text, stable: true }];
  };
}

/** Builds the opener; the runtime keeps it for the life of the daemon and calls close() on shutdown. */
export function buildOpener(h: OpenerHost): SessionOpener {
  const system = roleBlocks(h.call);
  // The plan is the host's, or the default for this platform built on the first CLI turn (it starts the network wall). No plan and no default: CLI turns refuse, never run unwrapped.
  let planned: Promise<SandboxPlan> | undefined;
  const plan = (): Promise<SandboxPlan> => {
    if (h.sandbox) return Promise.resolve(h.sandbox);
    if (!h.defaultSandbox) return Promise.reject(new SandboxError("sandbox.unavailable", "no sandbox is set up for CLI engines on this computer"));
    return (planned ??= h.defaultSandbox().catch((e: unknown) => { planned = undefined; throw e; }));
  };
  const dataDir = h.sandbox?.dataDir ?? h.dataDir;
  return createSessionOpener({
    source: h.session.source,
    reportMiss: h.session.reportMiss,
    mcp: h.session.mcp,
    launcher: {
      spawn: async (spec) => {
        const swap = spec.argv[0] !== undefined ? h.cliCommand?.[spec.argv[0]] : undefined;
        const argv = swap ? [...swap, ...spec.argv.slice(1)] : spec.argv;
        return createLocalLauncher({ wrap: sandboxWrap(await plan()) }).spawn({ ...spec, argv });
      },
    },
    // Behind the wall the engine cannot reach the daemon's loopback: its MCP config starts a stdio shim that talks to a unix socket in the person's scratch folder (ruling 61).
    ...(dataDir ? { mcpBridge: (m: { url: string; token: string }, spec: { asker: string }) => openMcpBridge(m, { scratch: scratchFolder(dataDir, spec.asker) }) } : {}),
    ...(dataDir ? { cli: { workFolder: (spec) => workFolder(dataDir, spec.asker, spec.threadId) } } : {}),
    apiContext: h.apiTools ? h.apiTools.context : async (spec) => ({ system: await system(spec), tools: [] }),
  });
}
