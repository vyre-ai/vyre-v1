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
  /** The folder bound at ~/Vyre in an agent's computer, made on first use. One folder per agent, one copy, no sync. */
  filesRoot(agentId: string): string | null;
  /** How long a wake waits for agentd (Xvfb and Chromium start before it answers). */
  startTimeoutMs?: number;
  /** The profile disk at rest: the node key and the folder for sealed profiles. A sleeping computer's profile is on the volume only while it runs. */
  profileSeal: { key(): Uint8Array; dir: string };
}

export interface ComputersHostDeps {
  /** The Space data directory: agent Files folders live under <dataDir>/computers/<agent>/Vyre. */
  dataDir: string;
  socketPath?: string;
  image?: string;
  startTimeoutMs?: number;
}

/** The node key for computer profiles: 32 random bytes in the data folder, mode 0600, made on first use and read at each use. It is never logged and never leaves this machine. */
function profileKey(file: string): Uint8Array {
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(t)) return Uint8Array.from(Buffer.from(t, "hex"));
  } catch { /* first use */ }
  const k = globalThis.crypto.getRandomValues(new Uint8Array(32));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${Buffer.from(k).toString("hex")}\n`, { mode: 0o600 });
  return k;
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createComputersHost(d: ComputersHostDeps): ComputersHostSeam {
  const root = path.join(d.dataDir, "computers");
  return {
    ...(d.socketPath !== undefined ? { socketPath: d.socketPath } : {}),
    image: d.image ?? process.env["VYRE_AGENT_COMPUTER_IMAGE"] ?? "vyre/agent-computer:1",
    startTimeoutMs: d.startTimeoutMs ?? 120_000,
    profileSeal: { key: () => profileKey(path.join(d.dataDir, "computers-profile.key")), dir: path.join(root, ".sealed") },
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
