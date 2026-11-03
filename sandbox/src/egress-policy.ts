// What a sandbox may reach on the network (owner ruling 3 Nov: AI tools use the internet the way they do in Claude Code and Codex). One rule, shared by every wall: bwrap on Linux, Seatbelt on a
// Mac, the Docker sandbox, and the WSL2 sandbox on Windows, which sends the rule into its VM as it is. The rule is plain JSON (no functions), so it can cross a process or a VM.
//
//   { egress: "public" }                 any public host on any port, by name or by public address
//   { egress: "list", allow: [...] }     only the names on the list (validHostPattern), on 443 and 80
//
// Whatever the rule, the proxy resolves a name once, checks every address it got, and connects to the checked one (no DNS rebinding). Never reachable: loopback, private, link-local and cloud
// metadata, carrier-grade NAT, multicast and reserved addresses (policy.isPrivateAddress); this machine's own addresses and the networks they sit on (the person's LAN, a server's neighbours);
// and Vyre's own ports. Files are confined by the sandbox as before; the network rule never opens a file.
import os from "node:os";
import net from "node:net";
import { isPrivateAddress, validHostPattern } from "./policy.ts";
import { SandboxError } from "./types.ts";

export type EgressRule =
  | { readonly egress: "public" }
  | { readonly egress: "list"; readonly allow: readonly string[] };

export const PUBLIC_RULE: EgressRule = Object.freeze({ egress: "public" });

/** Vyre's own default ports (the daemon, Caddy's admin): refused on every host in public mode, on top of this machine's own addresses. */
export const VYRE_PORTS: readonly number[] = [8420, 2019];

/** A rule from anything (a setting, an environment variable, a message from another computer). Refuses what is not exactly a rule; an allow-list is held to validHostPattern. */
export function validateRule(r: unknown): EgressRule {
  if (r === null || typeof r !== "object") throw new SandboxError("sandbox.policy", "the network rule is not an object");
  const o = r as Record<string, unknown>;
  if (o["egress"] === "public") {
    if (Object.keys(o).some((k) => k !== "egress")) throw new SandboxError("sandbox.policy", "the public network rule takes nothing else");
    return PUBLIC_RULE;
  }
  if (o["egress"] === "list") {
    const allow = o["allow"];
    if (!Array.isArray(allow) || allow.length > 500) throw new SandboxError("sandbox.policy", "the allow-list must be a list of at most 500 host names");
    if (Object.keys(o).some((k) => k !== "egress" && k !== "allow")) throw new SandboxError("sandbox.policy", "the list network rule takes only its hosts");
    for (const h of allow) if (typeof h !== "string" || !validHostPattern(h)) throw new SandboxError("sandbox.policy", `${JSON.stringify(h).slice(0, 80)} is not a host name the allow-list can hold`);
    return { egress: "list", allow: [...new Set(allow as string[])] };
  }
  throw new SandboxError("sandbox.policy", "the network rule must be public or a list");
}

/** The environment variable a spawn carries its rule in, from the opener to the launcher (the Space's own, or a member's computer the turn runs on). Removed before the engine starts. */
export const RULE_ENV = "VYRE_EGRESS_RULE";

export function ruleFromEnv(v: string | undefined): EgressRule | null {
  if (v === undefined || v === "") return null;
  try { return validateRule(JSON.parse(v)); } catch { throw new SandboxError("sandbox.policy", "the network rule this turn carries is not one Vyre writes"); }
}

// ---- this machine's own networks ----------------------------------------------------------------------------------------------------------------

export interface Cidr { address: string; prefix: number; family: 4 | 6 }

function v4num(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return null;
  return (((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!) >>> 0;
}

/** An IPv6 address as eight 16-bit words, or null. Accepts `::` and an IPv4 tail. */
function v6words(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  if (!net.isIPv6(s)) return null;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) { const n = v4num(tail[1]!); if (n === null) return null; s = `${s.slice(0, -tail[1]!.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`; }
  const [head, rest] = s.includes("::") ? s.split("::") as [string, string] : [s, null];
  const a = head === "" ? [] : head.split(":");
  const b = rest === null ? [] : rest === "" ? [] : rest.split(":");
  const fill = rest === null ? 0 : 8 - a.length - b.length;
  const words = [...a, ...Array(fill).fill("0"), ...b].map((w) => parseInt(w, 16));
  return words.length === 8 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : null;
}

export function inCidr(ip: string, c: Cidr): boolean {
  if (c.family === 4) {
    const a = v4num(ip), b = v4num(c.address);
    if (a === null || b === null) return false;
    if (c.prefix <= 0) return true;
    const mask = c.prefix >= 32 ? 0xffffffff : (~0 << (32 - c.prefix)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }
  const a = v6words(ip), b = v6words(c.address);
  if (!a || !b) return false;
  let bits = Math.max(0, Math.min(128, c.prefix));
  for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
    const m = bits >= 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
    if ((a[i]! & m) !== (b[i]! & m)) return false;
  }
  return true;
}

/** The networks this machine's interfaces sit on (address and prefix), loopback left out (isPrivateAddress has it). Read from the system; a test passes its own. */
export function ownNetworks(read: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces): Cidr[] {
  const out: Cidr[] = [];
  for (const list of Object.values(read())) for (const i of list ?? []) {
    if (i.internal) continue;
    const prefix = Number((i.cidr ?? "").split("/")[1]);
    const fam = i.family === "IPv4" || (i.family as unknown) === 4 ? 4 : 6;
    out.push({ address: i.address, prefix: Number.isFinite(prefix) ? prefix : fam === 4 ? 32 : 128, family: fam });
  }
  return out;
}

/** Why an address may not be reached, or null when it may. `own` are this machine's networks. */
export function addressRefusal(ip: string, own: readonly Cidr[]): "private_address" | "own_network" | null {
  if (isPrivateAddress(ip)) return "private_address";
  const fam = net.isIPv4(ip) ? 4 : 6;
  // the machine's own address, and every address on a network it sits on: a person's LAN that uses public addresses, a server's neighbours in the same block
  if (own.some((c) => c.family === fam && inCidr(ip, c))) return "own_network";
  return null;
}

// ---- what the tools inside need -------------------------------------------------------------------------------------------------------------------

/**
 * The variables that make the usual tools use the proxy without the model knowing: curl, git over HTTPS, npm, pip, cargo, go, Homebrew, Node's own fetch (NODE_USE_ENV_PROXY, Node 24) and the CLIs'
 * own web tools. `ssh` is given to git as a command that tunnels through the proxy (CONNECT host:22), so a git+ssh remote on a public host works when the rule lets it. `ssh` needs the bridge's
 * connect helper and the Node that runs it, which only the walled sandboxes have.
 */
export function toolProxyEnv(proxyUrl: string, ssh?: { node: string; helper: string; port: number; knownHosts: string }): Record<string, string> {
  const env: Record<string, string> = {
    HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, all_proxy: proxyUrl,
    NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1",
    NODE_USE_ENV_PROXY: "1",
    npm_config_proxy: proxyUrl, npm_config_https_proxy: proxyUrl,
    PIP_PROXY: proxyUrl,
    CARGO_HTTP_PROXY: proxyUrl,
    // git over HTTPS (libcurl), go modules and Homebrew's curl read the variables above themselves; GIT_CONFIG_COUNT is left to whatever else sets it
  };
  if (ssh) {
    const q = (s: string): string => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
    const proxyCommand = `ProxyCommand=${q(ssh.node)} ${q(ssh.helper)} ${ssh.port} %h %p`;
    // single quotes for git's shell, double quotes inside for the shell ssh runs the ProxyCommand with; -F /dev/null so ssh reads no config the sandbox cannot open
    const sq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
    env["GIT_SSH_COMMAND"] = ["ssh", "-F", "/dev/null", "-o", sq(proxyCommand), "-o", "StrictHostKeyChecking=accept-new", "-o", sq(`UserKnownHostsFile=${ssh.knownHosts}`), "-o", "BatchMode=yes", "-o", "ConnectTimeout=20"].join(" ");
  }
  return env;
}
