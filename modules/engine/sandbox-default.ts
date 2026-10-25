// The sandbox a daemon uses for CLI engines when the host gave no plan of its own (P-L2_23): without one, agents on a CLI account could not start at all. Linux with bubblewrap gets bwrap and
// the network wall (an egress proxy behind a unix socket); a Mac gets Seatbelt with an egress proxy on loopback. Where the platform truly cannot sandbox, the plan says so and every CLI turn
// refuses with sandbox.unavailable; it never falls back to running the engine unwrapped. The wall lives as long as the daemon: close() stops it.
import fs from "node:fs";
import path from "node:path";
import { createEgressProxy, startNetWall } from "../../sandbox/src/index.ts";
import type { EngineSandbox, SandboxPlan } from "./sandbox.ts";

/** What a CLI engine may reach through the proxy: its vendor's API and sign-in hosts, and nothing else. */
export const ENGINE_EGRESS_HOSTS: readonly string[] = [
  "api.anthropic.com", "*.anthropic.com", "claude.ai", "*.claude.ai", "api.openai.com", "*.openai.com", "chatgpt.com", "*.chatgpt.com", "api.x.ai", "*.x.ai",
];

export interface DefaultSandbox { plan: SandboxPlan; close(): Promise<void> }

export interface DefaultSandboxOptions {
  dataDir: string;
  platform?: NodeJS.Platform;
  /** Where to look for bwrap. Default: the usual places. */
  bwrapPaths?: readonly string[];
  egressHosts?: readonly string[];
  node?: string;
}

const BWRAP = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];

export async function defaultSandbox(o: DefaultSandboxOptions): Promise<DefaultSandbox> {
  const platform = o.platform ?? process.platform;
  const hosts = o.egressHosts ?? ENGINE_EGRESS_HOSTS;
  const node = o.node ?? process.execPath;
  const unavailable = (reason: string): DefaultSandbox => ({ plan: { sandbox: { kind: "server", reason }, dataDir: o.dataDir, egressHosts: hosts }, close: async () => undefined });
  const done = (sandbox: EngineSandbox, close: () => Promise<void>): DefaultSandbox => ({ plan: { sandbox, dataDir: o.dataDir, egressHosts: hosts }, close });
  if (platform === "linux") {
    if (!(o.bwrapPaths ?? BWRAP).some((p) => fs.existsSync(p))) return unavailable("bubblewrap (bwrap) is not installed on this server, so CLI engines cannot be sandboxed");
    const wall = await startNetWall({ allow: hosts });
    return done({ kind: "bwrap", wallDir: wall.dir, node }, () => wall.close());
  }
  if (platform === "darwin") {
    const proxy = createEgressProxy({ allow: hosts });
    const { port } = await proxy.listen();
    // Seatbelt denies reads by default: the program being run (this Node, and the CLI's install folders) must be readable.
    const programRead = [path.dirname(path.dirname(node)), path.join(process.env["HOME"] ?? "/", ".local"), "/opt/homebrew", "/usr/local"].filter((p) => p !== "/");
    return done({ kind: "seatbelt", proxyPort: port, programRead }, () => proxy.close());
  }
  return unavailable(`CLI engines cannot be sandboxed on ${platform}`);
}
