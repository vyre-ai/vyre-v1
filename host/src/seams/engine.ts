// The engine module's host seam (rulings 31 and 32): the module exports `hostSeams = { setEngineHost }` and the daemon hands it this half. The host never imports the module or the agent
// package, so everything here is structural: a way to run a capability for a person, the lease holder name, and the ports the session opener needs. The module builds the turn engine on
// its own database from these (modules/engine/runtime.ts); nothing in the host touches a turn.
import { createGuardedFetch } from "../../../lib/net-guard.ts";
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

/** A live turn event as the bridge reports it (modules/engine/handlers/bridge.ts StreamEvent), structural here. */
export type EngineStreamEvent =
  | { kind: "start"; threadId: string; turnId: string; agentId: string; asker: string }
  | { kind: "delta"; threadId: string; turnId: string; agentId: string; text: string }
  | { kind: "end"; threadId: string; turnId: string; agentId: string; state: "done" | "failed" | "cancelled" | "waiting" }
  | { kind: "final"; threadId: string; turnId: string; agentId: string; messageId: string | null };

/** Where a live turn frame goes: every live socket whose person `allow` says may read the thread. */
export type PublishTurn = (frame: { t: "turn"; turn: string; delta: Record<string, unknown> }, allow: (personId: string) => boolean | Promise<boolean>) => void;

export interface EngineHostSeam {
  /** Forget who was allowed to watch turns, so the next piece of text asks again (a member left, a grant was revoked). */
  forgetReaders?: () => void;
  /** Live turn events, already filtered to who may read the thread. Absent: nothing streams and the reply lands whole, as before. */
  stream?: (e: EngineStreamEvent) => void;
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
  /** A scripted session opener (tests). Handed to the module as is; the real opener is not built. */
  openSession?: unknown;
  /** The daemon's invoke pipeline and Space id, for tools on API-key chats. */
  invoke?: Invoke;
  space?: string;
  /** True when the person is on their own computer: a local model or custom endpoint on loopback or the private network is then allowed (lib/net-guard.ts). */
  own?: (person: string) => boolean;
  /** The computers that joined the Space, for a turn pinned to one of them: start the engine process there over its live socket. Absent: no turn runs on a node. */
  nodes?: EngineNodes;
}

/** Start a process on a node (host/src/routes/compute-stream.ts spawnProc), structural here. A rejection carries an engine.* `code`. */
export interface EngineNodes {
  spawn(nodeId: string, spec: { argv: readonly string[]; cwd?: string; env: Readonly<Record<string, string>> }): Promise<{
    readonly pid: number | undefined; readonly stdout: AsyncIterable<Uint8Array>; write(data: string): Promise<void>; endInput(): void;
    readonly exited: Promise<{ code: number | null; signal: string | null }>; stderrTail(): string; kill(signal?: "SIGTERM" | "SIGKILL"): void;
  }>;
  connected(nodeId: string): boolean;
  /** Is the node's link private? An account key is sent only over one that is. */
  secure(nodeId: string): boolean;
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
  /** The live socket's publisher; late-bound because the socket opens after the modules load. */
  publishTurn?: () => PublishTurn | null;
  own?: (person: string) => boolean;
  openSession?: unknown;
  nodes?: EngineNodes;
  /** See EngineHostSeam.mcpFetch and pluginLaunch (modules/engine/runtime.ts). */
  mcpFetch?: unknown;
  pluginLaunch?: unknown;
}

/** A backstop only: the answer is also dropped the moment an event says a member or a grant went away (forgetReaders). */
/** Events after which who may read a chat may have changed: the daemon makes the host forget who was watching. */
export const READER_LOSS = /removed|revoked|disengaged|erased|closed|archived|left$/;
export const READER_TTL_MS = 15_000;

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
  // Who may watch a turn: whoever can read the thread (the same threads.get a person's own screen makes). The answer is kept a minute, so a stream of deltas asks once.
  const seen = new Map<string, { at: number; ok: Promise<boolean> }>();
  let epoch = 0;   // bumped when readers are forgotten, so an answer that was in flight across a removal is asked again and never trusted
  const mayRead = (threadId: string, person: string): Promise<boolean> => {
    const k = `${threadId}\u0000${person}`, t = (d.now ?? Date.now)();
    const hit = seen.get(k);
    if (hit && t - hit.at < READER_TTL_MS) return hit.ok;
    const asked = epoch;
    const ok = call("threads.get", { threadId }, person).then(() => true, () => false).then((yes) => (asked === epoch ? yes : mayRead(threadId, person)));
    seen.set(k, { at: t, ok });
    if (seen.size > 2000) for (const [key, v] of seen) if (t - v.at >= READER_TTL_MS) seen.delete(key);
    return ok;
  };
  const stream: EngineHostSeam["stream"] = (e) => {
    const pub = d.publishTurn?.();
    if (!pub) return;
    const { turnId, kind, ...rest } = e;
    pub({ t: "turn", turn: turnId, delta: { kind, ...rest } }, (person) => mayRead(e.threadId, person));
  };
  const session = d.vault ? createEngineSessionHost({ invoke: d.invoke, vault: d.vault, space: d.space, ...(d.log ? { log: d.log } : {}) }) : undefined;
  return { holder: `host:${d.space}`, call, postAs, ...(d.publishTurn ? { stream, forgetReaders: () => { epoch++; seen.clear(); } } : {}), ...(d.now ? { now: d.now } : {}), ...(d.log ? { log: d.log } : {}), ...(session ? { session } : {}), ...(d.sandbox !== undefined ? { sandbox: d.sandbox } : {}), ...(d.dataDir ? { dataDir: d.dataDir } : {}), ...(d.cli !== undefined ? { cli: d.cli } : {}), ...(d.openSession !== undefined ? { openSession: d.openSession } : {}), invoke: d.invoke, space: d.space, ...(d.own ? { own: d.own } : {}), ...(d.nodes ? { nodes: d.nodes } : {}), mcpFetch: d.mcpFetch ?? createGuardedFetch({ own: false }), ...(d.pluginLaunch !== undefined ? { pluginLaunch: d.pluginLaunch } : {}) };
}
