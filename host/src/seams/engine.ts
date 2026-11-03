// The engine module's host seam (rulings 31 and 32): the module exports `hostSeams = { setEngineHost }` and the daemon hands it this half. The host never imports the module or the agent
// package, so everything here is structural: a way to run a capability for a person, the lease holder name, and the ports the session opener needs. The module builds the turn engine on
// its own database from these (modules/engine/runtime.ts); nothing in the host touches a turn.
import { createGuardedFetch } from "../../../lib/net-guard.ts";
import type { Invoke } from "../invoke.ts";
import { createEngineSessionHost } from "./engine-session.ts";
import type { EngineSessionHost } from "./engine-session.ts";
import type { VaultPort } from "./ports.ts";
import type { SigninRefresh } from "./signin-refresh.ts";

/** Run one capability through the invoke pipeline. `as` is the person it runs for; omitted, the host's own service principal (used for the pipeline's own bookkeeping). */
export type EngineInvoke = (cap: string, input: unknown, as?: string) => Promise<unknown>;

/** What an agent posts into a chat, as the bridge builds it (modules/engine/handlers/bridge.ts AgentPost). */
export interface EngineAgentPost { actingFor?: string; sharedKey?: boolean; threadId: string; body: string; blocks: Array<{ type: string; v: number; data: unknown }>; mentions: unknown[]; clientId: string; via?: { routineOwner: string } }

/** Plain ports for the session opener (agent/src/drivers/open): a Vault lookup that returns a secret for a handle, a loopback MCP token, and the scrub-miss report. */
export type EngineSessionPorts = EngineSessionHost;

/** A live turn event as the bridge reports it (modules/engine/handlers/bridge.ts StreamEvent), structural here. */
export type EngineStreamEvent =
  | { kind: "start"; threadId: string; turnId: string; agentId: string; asker: string }
  | { kind: "delta"; threadId: string; turnId: string; agentId: string; text: string; /** the turn read something: its live text goes to the asker only until the answer is checked (gap 6) */ asker?: string; privately?: boolean }
  | { kind: "steps"; threadId: string; turnId: string; agentId: string; steps: unknown[] }
  | { kind: "thinking"; threadId: string; turnId: string; agentId: string; text: string; asker?: string }
  | { kind: "end"; threadId: string; turnId: string; agentId: string; state: "done" | "failed" | "cancelled" | "waiting"; code?: string }
  | { kind: "final"; threadId: string; turnId: string; agentId: string; messageId: string | null };

/** Where a live turn frame goes: every live socket whose person `allow` says may read the thread. */
export type PublishTurn = (frame: { t: "turn"; turn: string; delta: Record<string, unknown> }, allow: (personId: string) => boolean | Promise<boolean>) => void;

export interface EngineHostSeam {
  /** May every one of these people do this on this resource, each on their own grants? The engine checks an answer against everyone in the chat with it (gap 6). */
  mayAll?(people: readonly string[], action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }): boolean;
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
  /** Vyre installs a missing CLI engine into its own engines folder (modules/engine/engine-install.ts). Handed to the module as is. */
  engines?: { install?: boolean };
  /** A scripted session opener (tests). Handed to the module as is; the real opener is not built. */
  openSession?: unknown;
  /** The daemon's invoke pipeline and Space id, for tools on API-key chats. */
  invoke?: Invoke;
  space?: string;
  /** True when the person is on their own computer: a local model or custom endpoint on loopback or the private network is then allowed (lib/net-guard.ts). */
  own?: (person: string) => boolean;
  /** A Space server only: does it hold this person's key right now (they are signed in and opened it)? Absent on a person's own computer, where a turn waits for the key instead. */
  keyHeld?: (person: string) => boolean;
  /** Is this module db handle this daemon's own? Two daemons in one process (the two-computer tests) share the engine module, and only the daemon whose host half it holds builds its runtime. */
  ours?: (db: unknown) => boolean;
  /** The computers that joined the Space, for a turn pinned to one of them: start the engine process there over its live socket. Absent: no turn runs on a node. */
  nodes?: EngineNodes;
  /** The module calls it at shutdown with the promise of its close (sessions ended, refreshed sign-ins saved), so the daemon waits before the databases close. */
  closing?: (done: Promise<void>) => void;
  /** The module says how many turns run here now, each time it changes: the desktop shell waits for 0 before it stops the daemon to update the app (routes/local-work.ts). */
  turns?: (running: number) => void;
}

/** Start a process on a node (host/src/routes/compute-stream.ts spawnProc), structural here. A rejection carries an engine.* `code`. */
export interface EngineNodes {
  spawn(nodeId: string, spec: { argv: readonly string[]; cwd?: string; env: Readonly<Record<string, string>>; person?: string }): Promise<{
    readonly pid: number | undefined; readonly stdout: AsyncIterable<Uint8Array>; write(data: string): Promise<void>; endInput(): void;
    readonly exited: Promise<{ code: number | null; signal: string | null }>; stderrTail(): string; kill(signal?: "SIGTERM" | "SIGKILL"): void;
  }>;
  connected(nodeId: string): boolean;
  /** Is the node's link private? An account key is sent only over one that is. */
  secure(nodeId: string): boolean;
  /** The person's own computers linked to the Space right now (their Vyre app): node id `device:<id>`, the engines each runs (routes/compute-stream.ts DeviceLink). */
  devices?(person?: string): Array<{ nodeId: string; deviceId: string; person: string; name?: string; engines: string[]; since: number }>;
  /** Told when one of them links or goes. */
  onDevice?(fn: (link: { nodeId: string; deviceId: string; person: string; name?: string; engines: string[] }, up: boolean) => void): () => void;
}

export interface EngineHostDeps {
  space: string;
  /** Each person's own authorize, for the answer check (EngineHostSeam.mayAll). */
  mayAll?: EngineHostSeam["mayAll"];
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
  /** Install missing CLI engines into Vyre's own folder: on for the daemon's entry, off for a test daemon. */
  engineInstall?: boolean;
  /** The live socket's publisher; late-bound because the socket opens after the modules load. */
  publishTurn?: () => PublishTurn | null;
  /** Bytes into a Files upload slot (files.upload_url's address), in process: a goal's files over the inline limit go up this way (modules/engine/goal-folder.ts). */
  putToSlot?: (url: string, bytes: Uint8Array) => Promise<void>;
  own?: (person: string) => boolean;
  keyHeld?: (person: string) => boolean;
  ours?: (db: unknown) => boolean;
  openSession?: unknown;
  nodes?: EngineNodes;
  /** See EngineHostSeam.mcpFetch and pluginLaunch (modules/engine/runtime.ts). */
  mcpFetch?: unknown;
  pluginLaunch?: unknown;
  /** The host's save of sign-in files a CLI refreshed during a turn (signin-refresh.ts), handed to the session opener's ports. */
  saveSignin?: SigninRefresh["save"];
  /** Told at shutdown when the engine has closed its sessions and saved what their CLIs refreshed, so the daemon waits for it before the databases close. */
  closing?: (done: Promise<void>) => void;
  /** See EngineHostSeam.turns. */
  turns?: (running: number) => void;
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
  const run = async (cap: string, input: unknown, principal: { kind: "person" | "agent" | "service"; id: string }, actingFor?: string, sharedKey?: boolean): Promise<unknown> => {
    const r = await d.invoke(cap, input, { space: d.space, principal, origin: "engine", ...(actingFor ? { actingFor } : {}), ...(sharedKey ? { sharedKey } : {}), ...(principal.kind === "service" ? { preAuth: true } : {}) });
    if (r.status !== "ok") throw new Error(`${cap} was held for approval`);
    return r.output;
  };
  const call: EngineInvoke = (cap, input, as) => run(cap, input, as ? { kind: "person", id: as } : { ...SYSTEM });
  // chat.post is a keyed write: the bridge's own message id is the key, so a replay of the same reply is one post
  // An agent has no standing of its own in a Space: it speaks for the person whose turn it is, so what it may post is what that person may (the kernel answers agent_needs_actor otherwise).
  const postAs: EngineHostSeam["postAs"] = (agentId, { actingFor, sharedKey, ...post }) => run("chat.post", { ...post, idempotencyKey: `brg-${post.clientId}` }, { kind: "agent", id: agentId }, actingFor, sharedKey);
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
    // what the model thought may rest on what only the person who asked can read: in a shared chat it goes to them and nobody else (hole 8)
    // so may the text of a turn that read something, until its answer is checked against everyone who reads the chat (gap 6): the checked answer is posted for all
    const onlyAsker = kind === "thinking" || (kind === "delta" && e.privately === true) ? e.asker ?? "" : null;
    pub({ t: "turn", turn: turnId, delta: { kind, ...rest } }, (person) => (onlyAsker !== null ? person === onlyAsker : mayRead(e.threadId, person)));
  };
  const session = d.vault ? createEngineSessionHost({ invoke: d.invoke, vault: d.vault, space: d.space, ...(d.log ? { log: d.log } : {}), ...(d.saveSignin ? { saveSignin: d.saveSignin } : {}) }) : undefined;
  return { ...(d.closing ? { closing: d.closing } : {}), ...(d.turns ? { turns: d.turns } : {}), ...(d.mayAll ? { mayAll: d.mayAll } : {}), holder: `host:${d.space}`, call, postAs, ...(d.putToSlot ? { putToSlot: d.putToSlot } : {}), ...(d.publishTurn ? { stream, forgetReaders: () => { epoch++; seen.clear(); } } : {}), ...(d.now ? { now: d.now } : {}), ...(d.log ? { log: d.log } : {}), ...(session ? { session } : {}), ...(d.sandbox !== undefined ? { sandbox: d.sandbox } : {}), ...(d.dataDir ? { dataDir: d.dataDir } : {}), ...(d.cli !== undefined ? { cli: d.cli } : {}), ...(d.engineInstall ? { engines: { install: true } } : {}), ...(d.openSession !== undefined ? { openSession: d.openSession } : {}), invoke: d.invoke, space: d.space, ...(d.own ? { own: d.own } : {}), ...(d.keyHeld ? { keyHeld: d.keyHeld } : {}), ...(d.ours ? { ours: d.ours } : {}), ...(d.nodes ? { nodes: d.nodes } : {}), mcpFetch: d.mcpFetch ?? createGuardedFetch({ own: false }), ...(d.pluginLaunch !== undefined ? { pluginLaunch: d.pluginLaunch } : {}) };
}
