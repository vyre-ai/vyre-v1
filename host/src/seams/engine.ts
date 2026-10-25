// The engine module's host seam (rulings 31 and 32): the module exports `hostSeams = { setEngineHost }` and the daemon hands it this half. The host never imports the module or the agent
// package, so everything here is structural: a way to run a capability for a person, the lease holder name, and the ports the session opener needs. The module builds the turn engine on
// its own database from these (modules/engine/runtime.ts); nothing in the host touches a turn.
import type { VaultPort } from "./ports.ts";

/** Run one capability through the invoke pipeline. `as` is the person it runs for; omitted, the host's own service principal (used for the pipeline's own bookkeeping). */
export type EngineInvoke = (cap: string, input: unknown, as?: string) => Promise<unknown>;

/** Plain ports for the session opener (agent/src/drivers/open): a Vault lookup that returns a secret for a handle, a loopback MCP token, and the scrub-miss report. */
export interface EngineSessionPorts {
  source: unknown;
  mcp: unknown;
  reportMiss: unknown;
}

export interface EngineHostSeam {
  /** 'host:<space>' */
  holder: string;
  call: EngineInvoke;
  now?: () => number;
  /** The session opener's ports, built by createEngineSessionHost when the daemon has the Vault; the module turns them into `openSession`. */
  session?: EngineSessionPorts;
}

export interface EngineHostDeps {
  space: string;
  invoke: (cap: string, input: unknown, as: { kind: "person"; id: string } | null) => Promise<unknown>;
  now?: () => number;
  vault?: VaultPort;
  /** Builds the opener's ports from the invoke and the Vault; w2q's createEngineSessionHost (host/src/seams/engine-session.ts) fits here. */
  sessionHost?: (d: { invoke: EngineInvoke; vault: VaultPort; space: string }) => EngineSessionPorts;
}

export function createEngineHost(d: EngineHostDeps): EngineHostSeam {
  const call: EngineInvoke = (cap, input, as) => d.invoke(cap, input, as ? { kind: "person", id: as } : null);
  const session = d.vault && d.sessionHost ? d.sessionHost({ invoke: call, vault: d.vault, space: d.space }) : undefined;
  return { holder: `host:${d.space}`, call, ...(d.now ? { now: d.now } : {}), ...(session ? { session } : {}) };
}
