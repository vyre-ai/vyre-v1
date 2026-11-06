// Where a container runtime listens on a person's own computer (agent workspaces on a Personal Space, 6 Nov). A Team server names its socket itself (the runner, or /var/run/docker.sock); a desktop has
// whichever runtime the person installed, each with its own socket: Docker Desktop, Colima, OrbStack, Rancher Desktop, a rootless Docker, and a named pipe on Windows. The first that exists wins, and
// DOCKER_HOST (a unix:// address) beats them all. Apple's own `container` tool is not on this list: it has no Docker-compatible socket (see docs in the lane report), so it needs an adapter of its own.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SocketProbe {
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  platform?: NodeJS.Platform;
  uid?: number;
  /** Is there a socket (or pipe) at this path? Default: fs.statSync says it is one. */
  exists?: (p: string) => boolean;
}

const isSocket = (p: string): boolean => { try { const s = fs.statSync(p); return s.isSocket() || s.isFIFO() || s.isCharacterDevice(); } catch { return false; } };

/** The candidates in the order they are tried, with what each one is called in a sentence. */
export function socketCandidates(o: SocketProbe = {}): Array<{ path: string; runtime: string }> {
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const platform = o.platform ?? process.platform;
  const out: Array<{ path: string; runtime: string }> = [];
  const host = env["DOCKER_HOST"];
  if (host?.startsWith("unix://")) out.push({ path: host.slice("unix://".length), runtime: "the Docker engine named by DOCKER_HOST" });
  if (platform === "win32") { out.push({ path: "\\\\.\\pipe\\docker_engine", runtime: "Docker Desktop" }); return out; }
  out.push({ path: "/var/run/docker.sock", runtime: "Docker" });
  out.push({ path: path.join(home, ".docker", "run", "docker.sock"), runtime: "Docker Desktop" });
  out.push({ path: path.join(home, ".colima", "default", "docker.sock"), runtime: "Colima" });
  out.push({ path: path.join(home, ".orbstack", "run", "docker.sock"), runtime: "OrbStack" });
  out.push({ path: path.join(home, ".rd", "docker.sock"), runtime: "Rancher Desktop" });
  if (platform === "linux") out.push({ path: path.join(env["XDG_RUNTIME_DIR"] ?? `/run/user/${o.uid ?? process.getuid?.() ?? 1000}`, "docker.sock"), runtime: "rootless Docker" });
  return out;
}

/** The first runtime that answers on a socket that exists, or null. */
export function findDockerSocket(o: SocketProbe = {}): { path: string; runtime: string } | null {
  const exists = o.exists ?? isSocket;
  return socketCandidates(o).find((c) => exists(c.path)) ?? null;
}
