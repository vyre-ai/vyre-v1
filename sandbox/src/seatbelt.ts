// The Mac's sandbox (S8): a Seatbelt profile per session, run with sandbox-exec. Deny by default; the process may read the system and the program it runs, read and write the person's work folders
// and one scratch folder, and reach the network only at the egress proxy's port on loopback. The kernel enforces that last rule, so a process that ignores the proxy variables has nowhere to go.
// Paths in a profile are strings in a language that has quotes and parentheses; validateSpec has already refused a path with either, and sbplString escapes anyway.
import { proxyEnv } from "./docker.ts";
import { validateSpec } from "./policy.ts";
import type { Checked, PolicyOptions } from "./policy.ts";
import { SandboxError } from "./types.ts";
import type { Roots, SandboxSpec } from "./types.ts";

/** Folders every program needs to start and run. Read only. */
export const SYSTEM_READ: readonly string[] = [
  "/usr/lib", "/usr/bin", "/usr/sbin", "/usr/share", "/usr/libexec", "/bin", "/sbin", "/System/Library", "/Library/Frameworks", "/Library/Preferences/Logging",
  "/private/var/db/dyld", "/private/var/db/timezone", "/private/etc/ssl", "/private/etc/ssl", "/Library/Apple/System",
];
const DEVICES_READ = ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/tty"];

/** A string for a profile. A control character or a line break is refused; a backslash and a quote are escaped. */
export function sbplString(s: string): string {
  if (/[\u0000-\u001f\u007f]/u.test(s)) throw new SandboxError("sandbox.policy", "a profile string may not hold a control character");
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface SeatbeltOptions {
  /** Where the egress proxy listens on loopback. */
  proxyPort: number;
  /** Extra read-only folders for the program being run (the CLI's own install folder). Validated like a mount. */
  programRead?: readonly string[];
}

export function seatbeltProfile(checked: Checked, o: SeatbeltOptions): string {
  if (!Number.isInteger(o.proxyPort) || o.proxyPort < 1 || o.proxyPort > 65535) throw new SandboxError("sandbox.policy", "the proxy port is not a port");
  const lines: string[] = [
    "(version 1)",
    "(deny default)",
    ";; a program may start programs and threads, signal itself, and read how the machine is built",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow file-read-metadata)",
    "(allow mach-lookup (global-name \"com.apple.system.opendirectoryd.libinfo\") (global-name \"com.apple.logd\") (global-name \"com.apple.system.notification_center\") (global-name \"com.apple.trustd.agent\"))",
    ";; the system, read only",
    `(allow file-read* ${[...new Set([...SYSTEM_READ, ...(o.programRead ?? [])])].map((p) => `(subpath ${sbplString(p)})`).join(" ")})`,
    `(allow file-read* ${DEVICES_READ.map((p) => `(literal ${sbplString(p)})`).join(" ")})`,
    "(allow file-write* (literal \"/dev/null\") (literal \"/dev/tty\"))",
    ";; the person's folders",
  ];
  for (const m of checked.mounts) lines.push(m.mode === "rw" ? `(allow file-read* file-write* (subpath ${sbplString(m.host)}))` : `(allow file-read* (subpath ${sbplString(m.host)}))`);
  if (checked.scratch !== undefined) lines.push(`(allow file-read* file-write* (subpath ${sbplString(checked.scratch)}))`);
  // A unix socket in the scratch folder is how the engine reaches Vyre's MCP endpoint from inside (ruling 61): no network hole, one path.
  if (checked.scratch !== undefined) lines.push(";; unix sockets in the scratch folder only", `(allow network-outbound (remote unix-socket (subpath ${sbplString(checked.scratch)})))`);
  lines.push(
    ";; the only way out: the egress proxy, on loopback",
    `(allow network-outbound (remote ip ${sbplString(`localhost:${o.proxyPort}`)}))`,
    "",
  );
  return lines.join("\n");
}

export interface WrappedCommand { cmd: string; args: string[]; env: Record<string, string>; enforcement: { files: "kernel"; network: "kernel" } }

/** `sandbox-exec -p <profile> -- argv`, with the proxy variables set. */
export function seatbeltCommand(spec: SandboxSpec, roots: Roots, argv: readonly string[], o: SeatbeltOptions, policy?: PolicyOptions): WrappedCommand {
  if (argv.length === 0) throw new SandboxError("sandbox.policy", "nothing to run");
  const checked = validateSpec(spec, roots, policy);
  const proxy = `http://127.0.0.1:${o.proxyPort}`;
  return {
    cmd: "/usr/bin/sandbox-exec",
    args: ["-p", seatbeltProfile(checked, o), "--", ...argv],
    env: { ...(spec.env ?? {}), ...proxyEnv(proxy) },
    enforcement: { files: "kernel", network: "kernel" },
  };
}
