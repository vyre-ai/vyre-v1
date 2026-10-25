// The real session opener of the turn engine (ARCH 6.6, spec 4.14): the engine calls it with the account the accounts module already resolved, and it returns a leased session on the
// warm pool (agent/src/pool). Which driver runs is the account's: an API driver (Anthropic, OpenAI, OpenRouter, Google, xAI) for an API key, a CLI driver (Claude Code, Codex, Grok) for an
// engine on the asker's own computer or sandbox.
//
//   the key      goes in through the Vault fill (vault-use) and only there: into the CLI process's environment (fill-launcher.ts) or the request header (fill-authorizer.ts). The engine, the
//                event log, the transcript and every log line see the handle.
//   the tools    a CLI engine reaches Vyre over the loopback MCP endpoint with a token minted for this session: the agent as principal, the asker as the person it acts for, this thread.
//                The token is revoked when the session closes (pool eviction, idle timeout, shutdown).
//   the pool     a session is a lease on a warm one; closing it at the end of the turn gives it back. It is keyed by driver, account, model and (agent, asker), so a warm session is never
//                shared between two people's access.
import { createPool, poolOpenSession, warmHint } from "../../pool/index.ts";
import type { EnginePool, PoolDriver, PoolOptions, PoolSpec, ResolveSpec } from "../../pool/index.ts";
import type { OpenSession, SessionSpec } from "../../turn-engine/types.ts";
import type { Used, ValueSource, VaultRunDeps, Where } from "../../vault-use/index.ts";
import { ADAPTERS, DriverError, createApiDriver } from "../api/driver.ts";
import type { ApiDriverDeps } from "../api/driver.ts";
import type { SessionDeps } from "../api/session.ts";
import { PROVIDER_IDS } from "../api/types.ts";
import type { Clock, Fetch, ProviderId } from "../api/types.ts";
import { CLI_ADAPTERS, createCliDriver } from "../cli/driver.ts";
import type { CliDriverDeps } from "../cli/driver.ts";
import { CLI_IDS } from "../cli/types.ts";
import type { CliId, Launcher, McpEndpoint } from "../cli/types.ts";
import { cliCredential } from "./credentials.ts";
import type { CredentialKind } from "./credentials.ts";
import { createFillAuthorizer } from "./fill-authorizer.ts";
import { createFillLauncher } from "./fill-launcher.ts";
import type { FillWho } from "./fill-launcher.ts";

/** The account a turn runs on, as the accounts module resolved it (SessionSpec.account, agent/src/turn-engine/types.ts). `ref` is a Vault handle, never a value. */
export interface OpenAccount { ref: string; driver: string; kind: CredentialKind; payer?: string }

/** A session spec as the opener reads it: the engine adds the account and the turn's ids. A spec without an account never opens. */
export type OpenerSpec = SessionSpec & { account?: OpenAccount; turnId?: string; traceId?: string };

/** The loopback MCP sessions of CLI engines, as the host offers them (mcp.session.mint and mcp.session.close through the invoke pipeline). */
export interface McpPort {
  mint(i: { principal: string; actingFor: string; threadId: string; traceId: string }): Promise<{ sessionId: string; sessionToken: string; url: string; expiresAt: number }>;
  close(sessionId: string): Promise<void>;
}

export interface SessionOpenerDeps {
  source: ValueSource;
  reportMiss: VaultRunDeps["reportMiss"];
  /** Starts a CLI engine process (sandbox-wrapped on the host). The key reaches it only through the fill. */
  launcher: Launcher;
  mcp: McpPort;
  /**
   * Sandboxed engines (ruling 61): called after the MCP session is minted; returns the stdio command the engine runs as its Vyre MCP server (a shim that talks to a socket bind-mounted into the
   * sandbox) and how to close the bridge. The token stays in the process environment (VYRE_MCP_TOKEN); the shim sends it on each request. Omitted: the engine uses the loopback URL.
   */
  mcpBridge?(m: { url: string; token: string }, spec: OpenerSpec): Promise<{ stdio: { command: string; args: string[] }; close(): Promise<void> }>;
  /** The system prompt and tool list an API driver sends for a turn. */
  apiContext: SessionDeps["context"];
  /** Where the process runs, for the Vault's place rules. Default "host". */
  where?: Where;
  /** A device keeps a few sessions per driver; the host a few per person. Default "host". */
  placement?: PoolOptions["placement"];
  fetch?: Fetch;
  clock?: Clock;
  api?: Pick<ApiDriverDeps, "summarize" | "retry" | "idleMs" | "maxSteps" | "random">;
  cli?: Pick<CliDriverDeps, "system" | "workFolder" | "env" | "planMode" | "resume" | "idleMs" | "graceMs" | "prewarm">;
  pool?: Pick<PoolOptions, "maxPerDriver" | "maxPerPerson" | "maxTotal" | "idleMs" | "now">;
  /** A Vault item was used for a session: ids and handles only (audit and usage records). */
  onUsed?(e: { spec: OpenerSpec; used: readonly Used[] }): void;
}

export interface SessionOpener {
  /** The engine's `openSession` option. */
  openSession: OpenSession;
  /** The composer got focus or the thread was opened: start the engine ahead of the first message. Never throws, never waits. */
  warm(spec: SessionSpec): void;
  pool: EnginePool;
  /** Close every session (shutdown): processes end and MCP tokens are revoked. */
  close(): Promise<void>;
}

function need(spec: SessionSpec): OpenerSpec & { account: OpenAccount } {
  const s = spec as OpenerSpec;
  if (!s.account) throw new DriverError("engine.no_account", "No account is set for this turn.");
  return s as OpenerSpec & { account: OpenAccount };
}

export function createSessionOpener(d: SessionOpenerDeps): SessionOpener {
  const where = d.where ?? "host";
  const whoOf = (s: OpenerSpec): FillWho => ({ agentId: s.agent.id, asker: s.asker, where, traceId: s.traceId ?? s.turnId ?? s.threadId });
  const used = (spec: OpenerSpec) => (u: readonly Used[]): void => d.onUsed?.({ spec, used: u });
  /** token to MCP session id, so closing a session revokes exactly its token. */
  const minted = new Map<string, string>();
  const sockets = new Map<string, () => Promise<void>>();

  async function mcpFor(spec: OpenerSpec): Promise<McpEndpoint> {
    const m = await d.mcp.mint({ principal: spec.agent.id, actingFor: spec.asker, threadId: spec.threadId, traceId: spec.traceId ?? spec.turnId ?? spec.threadId });
    minted.set(m.sessionToken, m.sessionId);
    if (!d.mcpBridge) return { url: m.url, token: m.sessionToken };
    const bridge = await d.mcpBridge({ url: m.url, token: m.sessionToken }, spec);
    sockets.set(m.sessionToken, bridge.close);
    return { url: m.url, token: m.sessionToken, stdio: bridge.stdio };
  }
  async function mcpRevoke(endpoint: McpEndpoint): Promise<void> {
    const id = minted.get(endpoint.token);
    minted.delete(endpoint.token);
    const closeSocket = sockets.get(endpoint.token);
    sockets.delete(endpoint.token);
    await closeSocket?.().catch(() => undefined);
    if (id !== undefined) await d.mcp.close(id).catch(() => undefined);   // best effort: the token also expires by itself
  }

  const cliDriver = (id: CliId): PoolDriver => ({
    id, kind: "cli",
    async open(spec0) {
      const spec = need(spec0);
      const cred = cliCredential(id, spec.account.kind, spec.account.ref);
      if (!cred) throw new DriverError("engine.account_unsupported", `${id} cannot run on this kind of account yet. Use an API key for it.`);
      const launcher = createFillLauncher({ inner: d.launcher, source: d.source, reportMiss: d.reportMiss, who: whoOf(spec), env: { [cred.env]: cred.handle }, onUsed: used(spec) });
      const driver = createCliDriver(CLI_ADAPTERS[id], { ...d.cli, launcher, mcp: () => mcpFor(spec), mcpClose: (_s, endpoint) => mcpRevoke(endpoint) });
      return driver.open(spec);
    },
  });

  const apiDriver = (id: ProviderId): PoolDriver => ({
    id, kind: "api",
    async open(spec0) {
      const spec = need(spec0);
      const driver = createApiDriver(ADAPTERS[id], {
        ...d.api, context: d.apiContext, ...(d.fetch ? { fetch: d.fetch } : {}), ...(d.clock ? { clock: d.clock } : {}),
        authorize: createFillAuthorizer({ source: d.source, reportMiss: d.reportMiss, who: whoOf(spec), onUsed: used(spec) }),
        accountOf: (s) => ({ ref: need(s).account.ref }),
      });
      return driver.open(spec);
    },
  });

  const drivers: PoolDriver[] = [...CLI_IDS.map(cliDriver), ...PROVIDER_IDS.map(apiDriver)];
  const known = new Set(drivers.map((x) => x.id));
  const pool = createPool({ placement: d.placement ?? "host", drivers, ...d.pool });

  const resolve: ResolveSpec = (spec): PoolSpec => {
    const s = need(spec);
    if (!known.has(s.account.driver)) throw new DriverError("engine.unknown_driver", `There is no engine called ${s.account.driver}.`);
    return {
      key: { driver: s.account.driver, accountRef: s.account.ref, model: s.agent.model ?? "", sandboxId: null, mcpProfile: `${s.agent.id}|${s.asker}` },
      threadId: s.threadId, person: s.asker, session: spec,
    };
  };
  const open = poolOpenSession(pool, resolve);

  return {
    openSession: open,
    warm: (spec) => warmHint(pool, resolve, spec),
    pool,
    close: () => pool.close(),
  };
}
