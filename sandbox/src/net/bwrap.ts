// The Linux person's sandbox with a wall (S8, spec 4.17, ARCH 6.6): bubblewrap with its own network namespace and nothing in it but loopback. bwrapCommand shares the machine's network and steers it
// with proxy variables, which a process can unset; this has no network to share. The one way out is the unix socket of the egress proxy, bound read-only in a folder of its own, with a bridge program
// that listens on 127.0.0.1:3128 inside the namespace and passes each connection to the socket. The bridge is the first thing bwrap runs and it starts the command, so it is up before the command is,
// and ends when the command does. Files are enforced by the kernel as before; the network is now enforced by the kernel too: `enforcement.network` is "kernel".
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { proxyEnv } from "../docker.ts";
import { validateSpec } from "../policy.ts";
import type { PolicyOptions } from "../policy.ts";
import { SandboxError } from "../types.ts";
import type { CredentialFile, ExecResult, ExecSpec, Roots, Sandbox, SandboxSpec } from "../types.ts";
import { GUEST_BRIDGE, GUEST_DIR, GUEST_PORT, GUEST_SOCKET } from "./guest.ts";
import { startNetWall } from "./host.ts";
import type { NetWall, NetWallOptions } from "./host.ts";

const SYSTEM_RO: readonly string[] = ["/usr", "/etc/ssl", "/etc/ca-certificates", "/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/localtime"];
const HOME = "/home/agent";
/** bwrap is started with an empty environment, so it must be found by path (an empty PATH finds nothing). */
const BWRAP = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"].find((p) => fs.existsSync(p)) ?? "bwrap";

export interface BwrapWallOptions {
  /** The folder startNetWall made (socket and bridge). */
  wallDir: string;
  /** The Node that runs the bridge. Default: the one running this process. */
  node?: string;
  /** Extra read-only folders for the program being run. */
  programRead?: readonly string[];
}

export interface WalledCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  enforcement: { files: "kernel"; network: "kernel" };
}

/** The Node install prefix, when it is not under /usr (an Actions toolcache, a version manager): the sandbox needs to see the binary and nothing else of it. */
function nodePrefix(node: string): string | undefined {
  if (node.startsWith("/usr/")) return undefined;
  const bin = path.dirname(node);
  return path.basename(bin) === "bin" ? path.dirname(bin) : bin;
}

export function bwrapWallCommand(spec: SandboxSpec, roots: Roots, argv: readonly string[], o: BwrapWallOptions, policy?: PolicyOptions): WalledCommand {
  if (argv.length === 0) throw new SandboxError("sandbox.policy", "nothing to run");
  const checked = validateSpec(spec, roots, policy);
  const node = o.node ?? process.execPath;
  // --unshare-all and no --share-net: a new network namespace, which bwrap brings loopback up in and nothing else.
  const a: string[] = ["--die-with-parent", "--new-session", "--unshare-all", "--cap-drop", "ALL"];
  const prefix = nodePrefix(node);
  for (const p of [...SYSTEM_RO, ...(prefix ? [prefix] : []), ...(o.programRead ?? [])]) a.push("--ro-bind-try", p, p);
  a.push("--symlink", "usr/bin", "/bin", "--symlink", "usr/sbin", "/sbin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64");
  a.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", HOME);
  for (const m of checked.mounts) a.push(m.mode === "rw" ? "--bind" : "--ro-bind", m.host, m.host);
  if (checked.scratch !== undefined) a.push("--bind", checked.scratch, checked.scratch);
  a.push("--ro-bind", o.wallDir, GUEST_DIR);
  const env: Record<string, string> = {
    ...(spec.env ?? {}), HOME, PATH: `${prefix ? `${prefix}/bin:` : ""}/usr/local/bin:/usr/bin:/bin`, LANG: "C.UTF-8", ...proxyEnv(`http://127.0.0.1:${GUEST_PORT}`),
  };
  // bwrap builds the new root as a writable tmpfs; nothing may be written on it. The binds above are their own mounts and stay as asked.
  a.push("--remount-ro", "/");
  a.push("--clearenv");
  for (const [k, v] of Object.entries(env)) a.push("--setenv", k, v);
  a.push("--chdir", checked.mounts[0]?.host ?? HOME, "--", node, GUEST_BRIDGE, GUEST_SOCKET, String(GUEST_PORT), "--", ...argv);
  return { cmd: "bwrap", args: a, env: {}, enforcement: { files: "kernel", network: "kernel" } };
}

export type WalledBwrapSandbox = Sandbox & { readonly network: "wall"; readonly enforcement: WalledCommand["enforcement"]; readonly proxyPort: number };

export interface WalledBwrapDeps {
  roots: Roots;
  policy?: PolicyOptions;
  egress?: NetWallOptions["egress"];
  baseDir?: string;
  node?: string;
  programRead?: readonly string[];
  /** The bwrap program. Default: the first of /usr/bin/bwrap, /usr/local/bin/bwrap, /bin/bwrap that exists. */
  bwrap?: string;
}

/** A Sandbox over bwrap with the wall: each exec is one bwrap process with its own namespaces; the proxy and its socket live until stop(). */
export async function startWalledBwrapSandbox(spec: SandboxSpec, deps: WalledBwrapDeps): Promise<WalledBwrapSandbox> {
  if (spec.kind !== "bwrap") throw new SandboxError("sandbox.policy", "this is the bwrap sandbox");
  validateSpec(spec, deps.roots, deps.policy);
  const wall: NetWall = await startNetWall({ allow: spec.egressHosts, ...(deps.egress ? { egress: deps.egress } : {}), ...(deps.baseDir ? { baseDir: deps.baseDir } : {}) });
  const bwrap = deps.bwrap ?? BWRAP;
  const opts: BwrapWallOptions = { wallDir: wall.dir, ...(deps.node ? { node: deps.node } : {}), ...(deps.programRead ? { programRead: deps.programRead } : {}) };
  let stopped = false;
  const proxyEnvVars = proxyEnv(`http://127.0.0.1:${GUEST_PORT}`);
  const sandbox: WalledBwrapSandbox = {
    id: spec.id, kind: "bwrap", network: "wall", enforcement: { files: "kernel", network: "kernel" }, proxyPort: wall.proxyPort,
    env: () => ({ ...(spec.env ?? {}), HOME, ...proxyEnvVars }),
    exec(e: ExecSpec): Promise<ExecResult> {
      if (stopped) return Promise.reject(new SandboxError("sandbox.stopped", "the sandbox is stopped"));
      if (e.argv.length === 0) return Promise.reject(new SandboxError("sandbox.policy", "nothing to run"));
      const w = bwrapWallCommand({ ...spec, env: { ...(spec.env ?? {}), ...(e.env ?? {}) } }, deps.roots, e.argv, opts, deps.policy);
      return new Promise((resolve) => {
        // bwrap itself is started with an empty environment: a process inside can read pid 1's, which is bwrap's own.
        const p = spawn(bwrap, w.args, { env: w.env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "", timedOut = false;
        p.stdout.on("data", (d) => (stdout += d));
        p.stderr.on("data", (d) => (stderr += d));
        const t = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, e.timeoutMs ?? 600_000);
        p.on("error", (err) => { clearTimeout(t); resolve({ exitCode: null, stdout, stderr: `${stderr}${err.message}`, timedOut }); });
        p.on("close", (code) => { clearTimeout(t); resolve({ exitCode: code, stdout, stderr, timedOut }); });
      });
    },
    async putCredentials(_files: readonly CredentialFile[]): Promise<void> { throw new SandboxError("sandbox.unsupported", "credentials go to a bwrap sandbox through the credential store, not here"); },
    async wipeCredentials(): Promise<void> {},
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await wall.close();
    },
  };
  return sandbox;
}
