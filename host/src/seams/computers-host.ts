// The computers module's host seam (rulings 31 and 32): the module exports `hostSeams = { setComputerHost }` and the daemon hands it this half. The host cannot import the module or the
// sandbox package (layer rule), so what it supplies is configuration: where the Docker engine is, which image is the agent computer, and the folder on this machine that is an agent's own
// Vyre Files folder. The module builds the Docker ComputerHost from it (createDockerComputerHost) and binds it; a daemon without Docker answers provider.unavailable from health, not at boot.
import fs from "node:fs";
import path from "node:path";

export interface ComputersHostSeam {
  /** The Docker Engine socket. Default /var/run/docker.sock. */
  socketPath?: string;
  /** The agent computer image. Default vyre/agent-computer:1 (images/agent-computer). */
  image?: string;
  /** The folder bound at ~/Vyre in an agent's computer, made on first use. It is a mirror of the agent's folder in Files (the module's home sync keeps the two together, as the agent). */
  filesRoot(agentId: string): string | null;
  /** The home mirror: every call to Files runs as the agent principal; a pass runs at wake, every few seconds while the computer runs, and at sleep. */
  home?: {
    callAs(agentId: string, cap: string, input: unknown): Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    putBytes(url: string, bytes: Uint8Array): Promise<void>;
    intervalMs?: number;
    manifest(agentId: string): string;
    log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
  };
  /** How long a wake waits for agentd (Xvfb and Chromium start before it answers). */
  startTimeoutMs?: number;
}

export interface ComputersHostDeps {
  /** The Space data directory: each agent computer's home folder lives under <dataDir>/computers/<agent>/Vyre, its sync manifest beside it. */
  dataDir: string;
  socketPath?: string;
  image?: string;
  startTimeoutMs?: number;
  /** Run a capability as the agent (the daemon's invoke pipeline with the agent principal, so access, review rules and the scrubber apply). Omitted: no home mirror. */
  callAs?: (agentId: string, cap: string, input: unknown) => Promise<unknown>;
  /** Send bytes to an upload url that files.upload_url handed out. */
  putBytes?: (url: string, bytes: Uint8Array) => Promise<void>;
  /** How often a pass runs while a computer is awake. Default 3 s. */
  homeIntervalMs?: number;
  log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createComputersHost(d: ComputersHostDeps): ComputersHostSeam {
  const root = path.join(d.dataDir, "computers");
  return {
    ...(d.socketPath !== undefined ? { socketPath: d.socketPath } : {}),
    image: d.image ?? process.env["VYRE_AGENT_COMPUTER_IMAGE"] ?? "vyre/agent-computer:1",
    startTimeoutMs: d.startTimeoutMs ?? 120_000,
    ...(d.callAs && d.putBytes ? { home: { callAs: d.callAs as never, putBytes: d.putBytes, ...(d.homeIntervalMs !== undefined ? { intervalMs: d.homeIntervalMs } : {}), manifest: (agentId: string) => path.join(root, agentId, "home-manifest.json"), ...(d.log ? { log: d.log } : {}) } } : {}),
    filesRoot(agentId) {
      if (!AGENT_ID.test(agentId)) return null;
      // the parent stays private to the daemon's user; the folder itself is open to the computer's own user (uid 10001), which only the bind mount can reach
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const dir = path.join(root, agentId, "Vyre");
      fs.mkdirSync(dir, { recursive: true });
      fs.chmodSync(path.join(root, agentId), 0o711);
      fs.chmodSync(dir, 0o777);
      return fs.realpathSync(dir);
    },
  };
}
