// The Linux person's sandbox (S8): bubblewrap with the same policy as the Mac's. New namespaces for everything, the system read only, an empty home, the person's folders bound in, all capabilities
// dropped, and the process dies with its parent. Files are enforced by the kernel. The network is shared with the machine and steered through the egress proxy by variables: that is not a wall,
// so `enforcement.network` says "proxy-env" and the engine driver may refuse to start where a wall is required. Windows has no native sandbox: its CLI engines run in WSL2 with this same profile.
import { proxyEnv } from "./docker.ts";
import { validateSpec } from "./policy.ts";
import type { PolicyOptions } from "./policy.ts";
import { SandboxError } from "./types.ts";
import type { Roots, SandboxSpec } from "./types.ts";

const SYSTEM_RO: readonly string[] = ["/usr", "/etc/ssl", "/etc/ca-certificates", "/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/localtime"];
const HOME = "/home/agent";

export interface BwrapOptions {
  /** Where the egress proxy listens on loopback. Absent: no network at all. */
  proxyPort?: number;
  /** Extra read-only folders for the program being run. */
  programRead?: readonly string[];
}

export interface WrappedCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  enforcement: { files: "kernel"; network: "kernel" | "proxy-env" };
}

export function bwrapCommand(spec: SandboxSpec, roots: Roots, argv: readonly string[], o: BwrapOptions = {}, policy?: PolicyOptions): WrappedCommand {
  if (argv.length === 0) throw new SandboxError("sandbox.policy", "nothing to run");
  const checked = validateSpec(spec, roots, policy);
  const a: string[] = ["--die-with-parent", "--new-session", "--unshare-all", "--cap-drop", "ALL"];
  if (o.proxyPort !== undefined) a.push("--share-net");
  for (const p of [...SYSTEM_RO, ...(o.programRead ?? [])]) a.push("--ro-bind-try", p, p);
  a.push("--symlink", "usr/bin", "/bin", "--symlink", "usr/sbin", "/sbin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64");
  a.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", HOME);
  for (const m of checked.mounts) a.push(m.mode === "rw" ? "--bind" : "--ro-bind", m.host, m.host);
  if (checked.scratch !== undefined) a.push("--bind", checked.scratch, checked.scratch);
  const env: Record<string, string> = {
    ...(spec.env ?? {}), HOME, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8",
    ...(o.proxyPort !== undefined ? proxyEnv(`http://127.0.0.1:${o.proxyPort}`) : {}),
  };
  // bwrap builds the new root as a writable tmpfs; nothing may be written on it (the real bwrap run found the self-test could). The binds above are their own mounts and stay as asked.
  a.push("--remount-ro", "/");
  a.push("--clearenv");
  for (const [k, v] of Object.entries(env)) a.push("--setenv", k, v);
  a.push("--chdir", checked.mounts[0]?.host ?? HOME, "--", ...argv);
  return { cmd: "bwrap", args: a, env: {}, enforcement: { files: "kernel", network: o.proxyPort === undefined ? "kernel" : "proxy-env" } };
}
