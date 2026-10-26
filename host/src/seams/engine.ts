// The engine module's host seam (rulings 31 and 32): the module exports `hostSeams = { setEngineHost }` and the daemon hands it this half. The host never imports the module or the agent
// package, so everything here is structural: a way to run a capability for a person, the lease holder name, and the ports the session opener needs. The module builds the turn engine on
// its own database from these (modules/engine/runtime.ts); nothing in the host touches a turn.
import type { Invoke } from "../invoke.ts";
import { createEngineSessionHost } from "./engine-session.ts";
import type { EngineSessionHost } from "./engine-session.ts";
import type { VaultPort } from "./ports.ts";

/** Run one capability through the invoke pipeline. `as` is the person it runs for; omitted, the host's own service principal (used for the pipeline's own bookkeeping). */
export type EngineInvoke = (cap: string, input: unknown, as?: string) => Promise<unknown>;

/** What an agent posts into a chat, as the bridge builds it (modules/engine/handlers/bridge.ts AgentPost). */
export interface EngineAgentPost { actingFor?: string; threadId: string; body: string; blocks: Array<{ type: string; v: number; data: unknown }>; mentions: unknown[]; clientId: string; via?: { routineOwner: string } }

/** Plain ports for the session opener (agent/src/drivers/open): a Vault lookup that returns a secret for a handle, a loopback MCP token, and the scrub-miss report. */
export type EngineSessionPorts = EngineSessionHost;

export interface EngineHostSeam {
  /** 'host:<space>' */
  holder: string;
  call: EngineInvoke;
  /** chat.post with the agent as the principal: a service context cannot speak as an agent. */
  postAs: (agentId: string, post: EngineAgentPost) => Promise<unknown>;
  now?: () => number;
  /** Where the module logs what it cannot say any other way (a turn that failed, an agent reply it could not post): the daemon writes it to its log sink. */
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
  /** The session opener's ports, built by createEngineSessionHost when the daemon has the Vault; the module turns them into `openSession`. */
  session?: EngineSessionPorts;
  /** Where CLI engines run sandboxed (modules/engine/sandbox.ts SandboxPlan, structural here). Absent: a CLI turn fails with sandbox.unavailable and never runs unwrapped. */
  sandbox?: unknown;
  /** The Space data directory: work folders and the default sandbox are made under it. */
  dataDir?: string;
  /** CLI program swap and extra sandbox read folders (tests). Handed to the module as is. */
  cli?: unknown;
  /** The daemon's invoke pipeline and Space id, for tools on API-key chats. */
  invoke?: Invoke;
  space?: string;
}

export interface EngineHostDeps {
  space: string;
  /** The daemon's invoke pipeline. */
  invoke: Invoke;
  now?: () => number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
  /** Without the Vault there is no key to fill, so no real session opener: the engine stays unbound. */
  vault?: VaultPort;
  /** Handed to the module as is; the host does not look inside it. Omitted: the module builds the default sandbox for the platform. */
  sandbox?: unknown;
  dataDir?: string;
  cli?: unknown;
}

const SYSTEM = { kind: "service", id: "svc_host" } as const;

/**
 * The host half of the engine: capabilities run for a person through the real pipeline (authorized as that person, so the asker's own access limits what a turn can read), the agent
 * speaks into chat as itself, and the session opener's ports come from the Vault.
 */
export function createEngineHost(d: EngineHostDeps): EngineHostSeam {
  const run = async (cap: string, input: unknown, principal: { kind: "person" | "agent" | "service"; id: string }, actingFor?: string): Promise<unknown> => {
    const r = await d.invoke(cap, input, { space: d.space, principal, origin: "engine", ...(actingFor ? { actingFor } : {}), ...(principal.kind === "service" ? { preAuth: true } : {}) });
    if (r.status !== "ok") throw new Error(`${cap} was held for approval`);
    return r.output;
  };
  const call: EngineInvoke = (cap, input, as) => run(cap, input, as ? { kind: "person", id: as } : { ...SYSTEM });
  // chat.post is a keyed write: the bridge's own message id is the key, so a replay of the same reply is one post
  // An agent has no standing of its own in a Space: it speaks for the person whose turn it is, so what it may post is what that person may (the kernel answers agent_needs_actor otherwise).
  const postAs: EngineHostSeam["postAs"] = (agentId, { actingFor, ...post }) => run("chat.post", { ...post, idempotencyKey: `brg-${post.clientId}` }, { kind: "agent", id: agentId }, actingFor);
  const session = d.vault ? createEngineSessionHost({ invoke: d.invoke, vault: d.vault, space: d.space }) : undefined;
  return { holder: `host:${d.space}`, call, postAs, ...(d.now ? { now: d.now } : {}), ...(d.log ? { log: d.log } : {}), ...(session ? { session } : {}), ...(d.sandbox !== undefined ? { sandbox: d.sandbox } : {}), ...(d.dataDir ? { dataDir: d.dataDir } : {}), ...(d.cli !== undefined ? { cli: d.cli } : {}), invoke: d.invoke, space: d.space };
}
