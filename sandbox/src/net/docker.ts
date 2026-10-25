// The person's Docker sandbox with a wall instead of a steer (S8, spec 4.17): the container has NO network (`--network none`: loopback only), so there is no bridge, no gateway address, no route and
// no host service to reach, however it is bound on the host (127.0.0.1, 0.0.0.0, the bridge address). Its one way out is a unix socket, bind-mounted read-only with the bridge program in a
// folder of its own, that leads to the egress proxy on the host's loopback. The container's main process is the bridge, listening on 127.0.0.1:3128 inside; HTTP_PROXY names it.
//
// Why not Docker's internal network with the proxy on the bridge's gateway (startDockerSandbox): an internal network stops what is routed out but not connections to the host itself, so a host service
// on 0.0.0.0 answered on the gateway address (found by P-L2_HEAVY). With no network there is nothing to find. Everything else is the same code: this wraps startDockerSandbox, replacing only the network
// calls and the container's command, binds and network mode, and the review of the finished config still runs.
import { networkName, reviewContainerConfig, startDockerSandbox } from "../docker.ts";
import type { ContainerConfig, DockerApi, DockerSandboxDeps } from "../docker.ts";
import { SandboxError } from "../types.ts";
import type { Sandbox, SandboxSpec } from "../types.ts";
import { GUEST_BRIDGE, GUEST_DIR, GUEST_PORT, GUEST_SOCKET } from "./guest.ts";
import { startNetWall } from "./host.ts";
import type { NetWall, NetWallOptions } from "./host.ts";

/** `proxyPort` is the proxy's own port on the host's loopback: informational, for tests that must prove the sandbox cannot open it. */
export type WalledSandbox = Sandbox & { readonly network: "wall"; readonly proxyPort: number };

export interface WalledDockerDeps extends Omit<DockerSandboxDeps, "startProxy" | "egress"> {
  egress?: NetWallOptions["egress"];
  /** Where the socket folder is made. Default: the system's temp folder. */
  baseDir?: string;
}

/** The config the wrapper hands to Docker: the one containerConfig built, with no network, the bridge as the main process, and the socket folder mounted read-only. */
export function wallConfig(c: ContainerConfig, wallDir: string): ContainerConfig {
  return {
    ...c,
    Cmd: ["node", GUEST_BRIDGE, GUEST_SOCKET, String(GUEST_PORT)],
    HostConfig: { ...c.HostConfig, NetworkMode: "none", Binds: [...c.HostConfig.Binds, `${wallDir}:${GUEST_DIR}:ro`] },
  };
}

/**
 * What a walled container must be, on top of everything reviewContainerConfig refuses: no network at all, the socket folder as the one extra bind and read-only, the bridge as the command, and a proxy
 * address that is the loopback bridge. Empty means the config is a wall.
 */
export function reviewWallConfig(c: ContainerConfig, id: string, workRoots: readonly string[], wallDir: string): string[] {
  const bad: string[] = [];
  const h = c.HostConfig;
  if (h.NetworkMode !== "none") bad.push(`network is ${h.NetworkMode}, not none`);
  const net = `${wallDir}:${GUEST_DIR}:ro`;
  if (h.Binds.filter((b) => b === net).length !== 1) bad.push("the socket folder is not bound exactly once, read-only");
  if (c.Cmd.join(" ") !== ["node", GUEST_BRIDGE, GUEST_SOCKET, String(GUEST_PORT)].join(" ")) bad.push("the command is not the bridge");
  const proxies = c.Env.filter((e) => /^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy)=/.test(e));
  if (proxies.length === 0 || proxies.some((e) => e.split("=")[1] !== `http://127.0.0.1:${GUEST_PORT}`)) bad.push("a proxy variable does not name the loopback bridge");
  // The rest of the profile is the existing review, on the config as the existing code builds it (its own network, only the person's folders bound).
  const asBuilt: ContainerConfig = { ...c, HostConfig: { ...h, NetworkMode: networkName(id), Binds: h.Binds.filter((b) => b !== net) } };
  bad.push(...reviewContainerConfig(asBuilt, id, workRoots));
  return bad;
}

function wrapApi(api: DockerApi, spec: SandboxSpec, roots: readonly string[], wall: NetWall): DockerApi {
  return {
    ping: () => api.ping(),
    imageExists: (name) => api.imageExists(name),
    // No network is made: the container gets none. The "gateway" is the loopback the bridge listens on, which only makes the proxy URL read http://127.0.0.1:3128.
    networkCreate: async () => ({ id: `wall-${spec.id}`, gateway: "127.0.0.1" }),
    networkRemove: async () => undefined,
    async containerCreate(name, config) {
      const walled = wallConfig(config, wall.dir);
      const problems = reviewWallConfig(walled, spec.id, roots, wall.dir);
      if (problems.length > 0) throw new SandboxError("sandbox.policy", `the walled container config is outside the profile: ${problems.join("; ")}`);
      return api.containerCreate(name, walled);
    },
    async containerStart(id) {
      await api.containerStart(id);
      // The bridge is the main process: when it listens, the sandbox has its way out. If the image has no node, or the socket is wrong, the sandbox does not start.
      const probe = `const s=require("node:net").connect(${GUEST_PORT},"127.0.0.1");s.on("connect",()=>process.exit(0));s.on("error",()=>process.exit(1))`;
      let last = "";
      for (let i = 0; i < 40; i++) {
        const r = await api.exec(id, { cmd: ["node", "-e", probe], env: [] }).catch((e: unknown) => ({ exitCode: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) }));
        if (r.exitCode === 0) return;
        last = r.stderr.slice(0, 120);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new SandboxError("sandbox.net", `the sandbox's bridge to the proxy did not come up: ${last || "no answer"}`);
    },
    containerStop: (id, grace) => api.containerStop(id, grace),
    containerRemove: (id) => api.containerRemove(id),
    containerRunning: (id) => api.containerRunning(id),
    exec: (id, a) => api.exec(id, a),
    putArchive: (id, dir, tar) => api.putArchive(id, dir, tar),
  };
}

/** startDockerSandbox with the wall. Same spec, same roots, same Sandbox; `network` says "wall". */
export async function startWalledDockerSandbox(spec: SandboxSpec, deps: WalledDockerDeps): Promise<WalledSandbox> {
  if (spec.kind !== "docker") throw new SandboxError("sandbox.policy", "this is the Docker sandbox");
  const wall = await startNetWall({ allow: spec.egressHosts, ...(deps.egress ? { egress: deps.egress } : {}), ...(deps.baseDir ? { baseDir: deps.baseDir } : {}) });
  try {
    const { egress: _egress, baseDir: _baseDir, ...rest } = deps;
    const sandbox = await startDockerSandbox(spec, { ...rest, api: wrapApi(deps.api, spec, deps.roots.work, wall), startProxy: async () => ({ port: GUEST_PORT, close: () => wall.close() }) });
    return Object.assign(sandbox, { network: "wall" as const, proxyPort: wall.proxyPort });
  } catch (e) {
    await wall.close().catch(() => undefined);
    throw e;
  }
}
