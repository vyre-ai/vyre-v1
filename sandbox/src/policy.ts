// What a sandbox may be asked to hold (S8). The mounts are the person's folders and nothing the machine would not hand that person: a path outside the roots, a path that climbs out of them, a link
// that leads out of them, or anything in the short list of places that must never be inside (the Docker socket, system folders, other people's homes, key stores) is refused before anything starts.
// The checks are on the spec, in this one place, so the Docker config, the Seatbelt profile and the bwrap arguments are all built from a spec that already passed.
import { SandboxError } from "./types.ts";
import type { Mount, Roots, SandboxSpec } from "./types.ts";

/** Names of folders and files that must not be inside a sandbox even when they sit under a root. */
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([".ssh", ".gnupg", ".aws", ".kube", ".docker", ".config/gcloud", ".netrc", ".git-credentials", ".vyre-keys"]);
const SOCKET = /(^|\/)(docker|podman|containerd|crio)\.sock$|\.sock$/i;
/** Places on the machine that are never a work folder, whatever the roots say. */
const SYSTEM: readonly string[] = ["/", "/etc", "/proc", "/sys", "/dev", "/boot", "/root", "/var/run", "/run", "/var/lib/docker", "/usr", "/bin", "/sbin", "/lib", "/System", "/Library", "/private/etc", "/private/var/run"];
const SAFE_ID = /^[a-z][a-z0-9-]{2,62}$/;
// Characters that could end a quoted string or a line in a sandbox profile or a bind option.
const BAD_PATH = /[\u0000-\u001f"'`\\()\u007f:;]/u;

/** Collapse `.`, empty and `..` segments. `null` when it climbs above `/`. */
export function normalizePath(p: string): string | null {
  if (!p.startsWith("/")) return null;
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (out.length === 0) return null; out.pop(); continue; }
    out.push(seg);
  }
  return `/${out.join("/")}`;
}

export const within = (path: string, root: string): boolean => path === root || path.startsWith(root === "/" ? "/" : `${root}/`);

export interface PolicyOptions {
  /** The real path of a path (links resolved). The default trusts the path as written; a host passes fs.realpath so a link out of a root is seen. */
  realpath?: (p: string) => string;
}

function checkPath(what: string, raw: string, roots: readonly string[], o: PolicyOptions): string {
  if (typeof raw !== "string" || raw === "") throw new SandboxError("sandbox.policy", `${what} has no path`);
  if (BAD_PATH.test(raw)) throw new SandboxError("sandbox.policy", `${what} has a character a path may not have: ${JSON.stringify(raw).slice(0, 80)}`);
  if (raw.split("/").includes("..")) throw new SandboxError("sandbox.policy", `${what} climbs out of its folder: ${raw}`);
  const norm = normalizePath(raw);
  if (norm === null) throw new SandboxError("sandbox.policy", `${what} must be an absolute path: ${raw}`);
  const real = o.realpath ? o.realpath(norm) : norm;
  const realNorm = normalizePath(real);
  if (realNorm === null) throw new SandboxError("sandbox.policy", `${what} resolves to something that is not a path: ${raw}`);
  for (const p of [norm, realNorm]) {
    if (SYSTEM.some((s) => p === s || (s !== "/" && within(p, s) && !roots.some((r) => within(r, s) && within(p, r))))) {
      throw new SandboxError("sandbox.policy", `${what} is in a place a sandbox never holds: ${p}`);
    }
    if (SOCKET.test(p)) throw new SandboxError("sandbox.policy", `${what} is a socket: ${p}`);
    const segs = p.split("/");
    for (const f of FORBIDDEN_SEGMENTS) {
      const parts = f.split("/");
      for (let i = 0; i + parts.length <= segs.length; i++) if (parts.every((x, j) => segs[i + j] === x)) throw new SandboxError("sandbox.policy", `${what} holds a key store (${f}): ${p}`);
    }
    if (!roots.some((r) => within(p, r))) throw new SandboxError("sandbox.policy", `${what} is outside the folders this person may share: ${p}`);
  }
  return norm;
}

export interface Checked {
  mounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
  scratch?: string;
}

/** Refuses a spec that would give the process more than its folders. Returns the normalized mounts. */
export function validateSpec(spec: SandboxSpec, roots: Roots, o: PolicyOptions = {}): Checked {
  if (!SAFE_ID.test(spec.id)) throw new SandboxError("sandbox.policy", "the sandbox id must be lowercase letters, digits and dashes");
  if (spec.user && (spec.user.uid === 0 || spec.user.gid === 0 || !Number.isInteger(spec.user.uid) || !Number.isInteger(spec.user.gid) || spec.user.uid < 0 || spec.user.gid < 0)) {
    throw new SandboxError("sandbox.policy", "a sandbox never runs as root");
  }
  if (spec.mounts.length === 0) throw new SandboxError("sandbox.policy", "a sandbox with no folder has nothing to work on");
  if (spec.mounts.length > 32) throw new SandboxError("sandbox.policy", "too many folders");
  const seen = new Set<string>();
  const mounts = spec.mounts.map((m: Mount, i) => {
    const host = checkPath(`mount ${i + 1}`, m.host, roots.work, o);
    if (m.mode !== "ro" && m.mode !== "rw") throw new SandboxError("sandbox.policy", `mount ${i + 1} must be ro or rw`);
    const guest = m.guest === undefined ? `/work/${host.split("/").filter(Boolean).slice(-1)[0] ?? "folder"}` : checkGuest(i + 1, m.guest);
    if (seen.has(guest)) throw new SandboxError("sandbox.policy", `two folders are mounted at ${guest}`);
    seen.add(guest);
    return { host, guest, mode: m.mode };
  });
  const out: Checked = { mounts };
  if (spec.scratch !== undefined) out.scratch = checkPath("the scratch folder", spec.scratch, roots.scratch, o);
  for (const h of spec.egressHosts) if (!validHostPattern(h)) throw new SandboxError("sandbox.policy", `${JSON.stringify(h).slice(0, 80)} is not a host name the allow-list can hold`);
  for (const k of Object.keys(spec.env ?? {})) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new SandboxError("sandbox.policy", `${k} is not an environment variable name`);
  return out;
}

function checkGuest(n: number, g: string): string {
  const norm = normalizePath(g);
  if (norm === null || BAD_PATH.test(g) || g.split("/").includes("..")) throw new SandboxError("sandbox.policy", `mount ${n} has a bad path inside the sandbox`);
  if (!(norm === "/work" || norm.startsWith("/work/") || norm.startsWith("/home/agent/"))) throw new SandboxError("sandbox.policy", `mount ${n} must sit under /work or the home folder`);
  return norm;
}

// ---- egress hosts -----------------------------------------------------------------------------------------------------------------------------------

const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const HOST = new RegExp(`^(${LABEL}\\.)+[a-z]{2,63}$`);

/** A name the allow-list can hold: a full host name, or `*.` and one. Never an address, never a bare TLD, never another wildcard. */
export function validHostPattern(p: string): boolean {
  const s = p.toLowerCase();
  if (s !== p) return false;
  return HOST.test(s.startsWith("*.") ? s.slice(2) : s) && !s.startsWith("*.*");
}

/** Does `host` (as the client named it) match one of the patterns? `*.example.com` matches `a.example.com` and `a.b.example.com`, not `example.com` and not `badexample.com`. */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!HOST.test(h)) return false;   // an address, a single label, a stray character: refused by name
  for (const p of patterns) {
    if (p.startsWith("*.")) { if (h.endsWith(p.slice(1)) && h.length > p.length - 1) return true; }
    else if (h === p) return true;
  }
  return false;
}

// ---- addresses --------------------------------------------------------------------------------------------------------------------------------------

function v4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** An address a sandbox must never be sent to by name: loopback, link-local (cloud metadata), private, carrier-grade NAT, multicast, reserved, unspecified. Unreadable counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const a = v4(ip);
  if (a) {
    const [o1 = 0, o2 = 0, o3 = 0] = a;
    return o1 === 0 || o1 === 10 || o1 === 127 || (o1 === 100 && o2 >= 64 && o2 <= 127) || (o1 === 169 && o2 === 254) || (o1 === 172 && o2 >= 16 && o2 <= 31)
      || (o1 === 192 && o2 === 0 && o3 === 0) || (o1 === 192 && o2 === 168) || (o1 === 198 && (o2 === 18 || o2 === 19)) || o1 >= 224;
  }
  const s = ip.toLowerCase();
  if (!s.includes(":")) return true;
  if (s === "::" || s === "::1") return true;
  const mapped = /^(?:0:0:0:0:0:ffff:|::ffff:)(.+)$/.exec(s);
  if (mapped?.[1] !== undefined) {
    const tail = mapped[1];
    if (v4(tail)) return isPrivateAddress(tail);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hex) { const hi = parseInt(hex[1] as string, 16); const lo = parseInt(hex[2] as string, 16); return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
    return true;
  }
  const first = s.split(":")[0] ?? "";
  const w = first === "" ? 0 : parseInt(first, 16);
  if (Number.isNaN(w)) return true;
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast, 64:ff9b::/96 NAT64 (could reach a private v4), 100::/64 discard, 2001:db8::/32 documentation
  return (w & 0xfe00) === 0xfc00 || (w & 0xffc0) === 0xfe80 || (w & 0xff00) === 0xff00 || s.startsWith("64:ff9b:") || s.startsWith("100:") || s.startsWith("2001:db8:") || s.startsWith("2001:0db8:");
}
