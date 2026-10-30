// The real session opener on a daemon (P-L2_23, with P-L2_23c): the host half hands plain ports (Vault lookup, loopback MCP, scrub-miss report); this builds agent/src/drivers/open's
// opener from them. A CLI engine (Claude Code, Codex, Grok) runs as a local process with the key filled into its environment and reaches Vyre over the loopback MCP endpoint, where the
// agent's tools run through the invoke pipeline. An API-key driver gets the agent's role as its system prompt and no tools yet: running its tools needs the engine's tool runner (callTool),
// which is a separate packet; until then a chat on an API key answers in words only.
import { createLocalLauncher } from "../../agent/src/drivers/cli/launcher.ts";
import { SandboxError } from "../../sandbox/src/index.ts";
import { openMcpBridge } from "./mcp-bridge.ts";
import { enginePath } from "./sandbox-default.ts";
import { sandboxWrap, scratchFolder, workFolder } from "./sandbox.ts";
import { nativePlugins } from "./plugin-native.ts";
import type { SandboxPlan } from "./sandbox.ts";
import type { ApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import type { SystemBlock } from "../../agent/src/drivers/api/types.ts";
import { createSessionOpener } from "../../agent/src/drivers/open/index.ts";
import type { McpPort, SessionOpener } from "../../agent/src/drivers/open/index.ts";
import type { ValueSource, VaultRunDeps } from "../../agent/src/vault-use/index.ts";
import { recallText } from "../../agent/src/turn-engine/recall.ts";
import { contextBlocks, ordered } from "../../agent/src/turn-engine/context.ts";
import type { ContextSection } from "../../agent/src/turn-engine/context.ts";
import { GUIDE_FILES, memoryGuide } from "../../lib/memory-guide.ts";
import fs from "node:fs";
import path from "node:path";
import type { SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";

/** What every engine process gets from the daemon's environment: the launcher's short list, with a PATH that finds the CLIs an app started from the Finder would not see. */
function launcherEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["HOME", "LANG", "TMPDIR"]) { const v = process.env[k]; if (v !== undefined) out[k] = v; }
  out["PATH"] = enginePath(process.env, process.env["HOME"] ?? "/");
  return out;
}

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
  own?: (person: string) => boolean;
  now?: () => number;
  /** Set false to keep installed plugins out of a CLI engine's own config. Default: they are written there. */
  pluginsNative?: boolean;
}

const MEMORY_RULES = "You remember through Vyre memory. Facts recalled for a message come with their source: say where you know a thing from. Quotes are the exact words people wrote in earlier chats and runs: quote them as written, never reword them, and use memory_quote with a ref to read a whole line or to look for words. Look up with memory_search, save what you learn with memory_remember and cite where it came from, and close a fact that is wrong or no longer true with memory_forget. Memory you cannot see is not yours to guess.";

/**
 * The system prompt of an API-key chat. With the turn context (modules/engine/context.ts) it is the ordered context: identity, rules, where, the memory block, skills, what the agent can do here,
 * the screen, the focus skill, the time, what it waits on. Stable sections come first and carry the cache marker. The memory block is the memory module's: the memory rules and the agent's MAP.md
 * as the nightly job last wrote it (agent layer only, never a person's memory); what memory recalled for this one message follows as a volatile block. A turn with no context (a failed build,
 * a test) gets the one-line role as before.
 */
export function roleBlocks(call: OpenerHost["call"]): (spec: SessionSpec, input?: TurnInput) => Promise<SystemBlock[]> {
  return async (spec, input) => {
    const memory: ContextSection[] = [{ id: "memory", stable: true, text: MEMORY_RULES }];
    try {
      const out = (await call("memory.map.get", { agentId: spec.agent.id }, spec.asker)) as { map?: { body?: string } };
      if (out.map?.body) memory.push({ id: "memory", stable: true, text: `Your memory map (MAP.md):\n${out.map.body}` });
    } catch { /* no map yet, or this person may not read it: the turn goes on without it */ }
    const blocks: SystemBlock[] = [];
    if (input?.context) {
      const merged: ContextSection[] = ordered([...input.context.sections, { id: "memory", stable: true, text: memory.map((m) => m.text).join("\n\n") }]);
      blocks.push(...contextBlocks({ ...input.context, sections: merged }));
    } else {
      let text: string;
      try {
        const out = (await call("agents.get", { agentId: spec.agent.id }, spec.asker)) as { agent?: { name?: string; role?: string } };
        const a = out.agent;
        text = `You are ${a?.name ?? spec.agent.id}, an agent in Vyre.${a?.role ? ` ${a.role}` : ""}`;
      } catch {
        text = `You are ${spec.agent.id}, an agent in Vyre.`;
      }
      blocks.push({ text, stable: true }, ...memory.map((m) => ({ text: m.text, stable: true })));
    }
    const recalled = input?.recall ? recallText(input.recall) : "";
    if (recalled !== "") blocks.push({ text: recalled, stable: false });
    return blocks;
  };
}

/**
 * The memory guide of this agent as the person asking may read it (agent layer only), in the CLI's work folder as CLAUDE.md and AGENTS.md. A CLI engine reads one of them from its folder,
 * so it knows it has memory and which tools reach it before its first tool call. The work folder is per person and thread, so nothing here reaches another person.
 */
export async function writeMemoryGuide(call: OpenerHost["call"], dir: string, spec: { agent: { id: string }; asker: string }): Promise<void> {
  let name: string = spec.agent.id;
  let body: string | undefined;
  try { name = ((await call("agents.get", { agentId: spec.agent.id }, spec.asker)) as { agent?: { name?: string } }).agent?.name ?? name; } catch { /* the id names it */ }
  try { body = ((await call("memory.map.get", { agentId: spec.agent.id }, spec.asker)) as { map?: { body?: string } }).map?.body; } catch { /* no map yet, or not this person's to read */ }
  const text = memoryGuide(name, body);
  for (const f of GUIDE_FILES) fs.writeFileSync(path.join(dir, f), text, { mode: 0o644 });
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
    ...(h.own ? { own: h.own } : {}),
    launcher: {
      spawn: async (spec) => {
        const swap = spec.argv[0] !== undefined ? h.cliCommand?.[spec.argv[0]] : undefined;
        const argv = swap ? [...swap, ...spec.argv.slice(1)] : spec.argv;
        return createLocalLauncher({ wrap: sandboxWrap(await plan()), baseEnv: launcherEnv() }).spawn({ ...spec, argv });
      },
    },
    // Behind the wall the engine cannot reach the daemon's loopback: its MCP config starts a stdio shim that talks to a unix socket in the person's scratch folder (ruling 61).
    ...(dataDir ? { mcpBridge: (m: { url: string; token: string }, spec: { asker: string }) => openMcpBridge(m, { scratch: scratchFolder(dataDir, spec.asker) }) } : {}),
    ...(dataDir && h.pluginsNative !== false ? { nativePlugins: (spec: SessionSpec, driver: "claude_code" | "codex") => nativePlugins({ call: h.call }, driver, spec.agent.id, spec.asker, workFolder(dataDir, spec.asker, spec.threadId)) } : {}),
    ...(dataDir ? { cli: { workFolder: (spec) => workFolder(dataDir, spec.asker, spec.threadId) } } : {}),
    ...(dataDir ? { prepare: (spec: { agent: { id: string }; asker: string; threadId: string }) => writeMemoryGuide(h.call, workFolder(dataDir, spec.asker, spec.threadId), spec) } : {}),
    apiContext: h.apiTools ? h.apiTools.context : async (spec, input) => ({ system: await system(spec, input), tools: [] }),
  });
}
