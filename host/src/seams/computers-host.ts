// The computers module's host seam (rulings 31 and 32): the module exports `hostSeams = { setComputerHost }` and the daemon hands it this half. The host cannot import the module or the
// sandbox package (layer rule), so what it supplies is configuration: where the Docker engine is, which image is the agent computer, and the folder on this machine that is an agent's own
// Vyre Files folder. The module builds the Docker ComputerHost from it (createDockerComputerHost) and binds it; a daemon without Docker answers provider.unavailable from health, not at boot.
import fs from "node:fs";
import path from "node:path";

export interface ComputersHostSeam {
  /** The Docker Engine socket. Default /var/run/docker.sock. */
  socketPath?: string;
  /** A Team server: the container runner's socket and its token (read again on each call), and the container vyred runs in. When set, vyred holds no Docker socket and uses this. */
  runner?: { socket: string; token(): string; ingress?: string; alias?: string };
  /** The agent computer image. Default vyre/agent-computer:1 (images/agent-computer). */
  image?: string;
  /** The Space browser image (images/space-browser). Default vyre/space-browser:1. */
  browserImage?: string;
  /** The folder bound at ~/Vyre in an agent's computer, made on first use. It is a mirror of the agent's folder in Files (the module's home sync keeps the two together, as the agent). */
  filesRoot(agentId: string): string | null;
  /** The home mirror: every call to Files runs as the agent principal; a pass runs at wake, every few seconds while the computer runs, and at sleep. */
  home?: {
    callAs(agentId: string, cap: string, input: unknown): Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    putBytes(url: string, bytes: Uint8Array): Promise<void>;
    intervalMs?: number;
    manifest(agentId: string): string;
    announce?: (a: { agentId: string; computerId: string; files: Array<{ fileId: string; name: string; kind: string; size: number; version: number }> }) => Promise<boolean | void>;
    log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
  };
  /** What this host says it can hold, instead of reading the machine (a test of room; the real host reads os.totalmem, os.freemem and the disk). */
  capacity?: () => Promise<{ totalMb: number; freeMb: number; cpus: number; os: string; diskFreeMb?: number }>;
  /** How long a wake waits for agentd (Xvfb and Chromium start before it answers). */
  startTimeoutMs?: number;
  /** The key and the folder for sealed browser profiles (modules/computers/handlers/seal.ts): an agent computer's profile disk and each agent's Chrome folder in the Space browser are sealed whenever nothing runs on them. */
  profileSeal?: { key(): Uint8Array; dir: string };
  /** Boot notes from the module (a profile sealed after a crash, a recovery that failed). */
  log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
}

export interface ComputersHostDeps {
  /** The Space data directory: each agent computer's home folder lives under <dataDir>/computers/<agent>/Vyre, its sync manifest beside it. */
  dataDir: string;
  socketPath?: string;
  runner?: { socket: string; token(): string; ingress?: string; alias?: string };
  image?: string;
  startTimeoutMs?: number;
  /**
   * The key sealed browser profiles are made under. THE ONE PLACE THE KEY IS CHOSEN. The Space server has no Space key of its own (ruling 72: the Space key is made on a client and sealed to the owner), and an agent's
   * computer must be able to wake while nobody is signed in, so the Space's at-rest key on the server is the one ctx.seal and the blob store already use (seal.key, the host's seal key, owner-held on the server);
   * the daemon passes it here and each profile gets its own key from it (HKDF in modules/computers/handlers/seal.ts). Omitted (a computer that joined): profiles stay in plain form.
   */
  profileKey?: () => Uint8Array;
  /** See ComputersHostSeam.capacity. */
  capacity?: () => Promise<{ totalMb: number; freeMb: number; cpus: number; os: string; diskFreeMb?: number }>;
  /** Run a capability as the agent (the daemon's invoke pipeline with the agent principal, so access, review rules and the scrubber apply). Omitted: no home mirror. */
  callAs?: (agentId: string, cap: string, input: unknown) => Promise<unknown>;
  /** Send bytes to an upload url that files.upload_url handed out. */
  putBytes?: (url: string, bytes: Uint8Array) => Promise<void>;
  /** Said once when the agent has made files on its computer: the daemon puts a file card in the chat the work was for. */
  announce?: (a: { agentId: string; computerId: string; files: Array<{ fileId: string; name: string; kind: string; size: number; version: number }> }) => Promise<boolean | void>;
  /** How often a pass runs while a computer is awake. Default 3 s. */
  homeIntervalMs?: number;
  log?: (level: "info" | "warn", msg: string, attrs?: Record<string, unknown>) => void;
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createComputersHost(d: ComputersHostDeps): ComputersHostSeam {
  const root = path.join(d.dataDir, "computers");
  return {
    ...(d.socketPath !== undefined ? { socketPath: d.socketPath } : {}),
    ...(d.runner ? { runner: d.runner } : {}),
    image: d.image ?? process.env["VYRE_AGENT_COMPUTER_IMAGE"] ?? "vyre/agent-computer:1",
    browserImage: process.env["VYRE_SPACE_BROWSER_IMAGE"] ?? "vyre/space-browser:1",
    startTimeoutMs: d.startTimeoutMs ?? 120_000,
    ...(d.profileKey ? { profileSeal: { key: d.profileKey, dir: path.join(root, ".sealed") } } : {}),
    ...(d.log ? { log: d.log } : {}),
    ...(d.capacity ? { capacity: d.capacity } : {}),
    ...(d.callAs && d.putBytes ? { home: { callAs: d.callAs as never, putBytes: d.putBytes, ...(d.homeIntervalMs !== undefined ? { intervalMs: d.homeIntervalMs } : {}), manifest: (agentId: string) => path.join(root, agentId, "home-manifest.json"), ...(d.announce ? { announce: d.announce } : {}), ...(d.log ? { log: d.log } : {}) } } : {}),
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
