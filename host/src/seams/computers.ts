// The Vault channel of agent computers, host half (P-L2_21): the module exports `hostSeams = { setComputersFill }` and the daemon hands it this. The Vault source is the engine session host's
// (the same vault.use check through the invoke pipeline, then the value from the Vault port), so the access rule and the label-vs-provider rule are the one implementation. The use log is a
// structured log line with ids and the outcome, never the value. The route is mounted by the daemon: POST <base>/computers/fill with `Authorization: Bearer <fillToken>`.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Invoke } from "../invoke.ts";
import { createEngineSessionHost } from "./engine-session.ts";
import type { VaultPort } from "./ports.ts";

export const FILL_PATH = "/computers/fill";

export interface FillUseRecord { computerId: string; agentId: string; asker: string; handle: string; itemId: string; outcome: "filled" | "refused" | "missing"; at: number }

export interface ComputersFillHostDeps {
  space: string;
  invoke: Invoke;
  vault: VaultPort;
  /** The address agentd can reach the daemon at from inside its container, read when a computer starts (the port is known only once the daemon listens). */
  baseUrl(): string;
  /** Where the module's request handler is mounted. */
  mount(handler: (req: IncomingMessage, res: ServerResponse) => void): void;
  log(use: FillUseRecord): void;
  now?: () => number;
}

export function createComputersFillHost(d: ComputersFillHostDeps) {
  const session = createEngineSessionHost({ invoke: d.invoke, vault: d.vault, space: d.space });
  return {
    source: session.source,
    log: (u: FillUseRecord) => d.log(u),
    url: () => `${d.baseUrl().replace(/\/+$/, "")}${FILL_PATH}`,
    mount: d.mount,
    ...(d.now ? { now: d.now } : {}),
  };
}

/** The request hook for the daemon's server: it takes POST FILL_PATH once a handler is mounted and leaves everything else alone. */
export function createFillRoute() {
  let handler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
  return {
    mount(h: ((req: IncomingMessage, res: ServerResponse) => void) | null): void { handler = h; },
    handle(req: IncomingMessage, res: ServerResponse): boolean {
      const path = (req.url ?? "").split("?")[0];
      if (path !== FILL_PATH) return false;
      if (!handler) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "not_found" })); return true; }
      handler(req, res);
      return true;
    },
  };
}
