// The app's own update channel (spec b13, ARCH 10.7): the desktop app updates on its own channel, apart from the server's. One update manifest lists
// the app versions available per platform; a server and an app tolerate each other within two minor versions, so releases can finish at different times.
// The manifest is signed with the Vyre release key (Ed25519); the signature is checked by the code that downloads it, this file reads what the manifest says.

export const CHANNELS = ["stable", "beta", "nightly"] as const;
export type ChannelName = (typeof CHANNELS)[number];
export const PLATFORMS = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "windows-aarch64", "linux-x86_64", "linux-aarch64"] as const;
export type PlatformKey = (typeof PLATFORMS)[number];
/** A server supports apps this many minor versions behind or ahead of it. */
export const MINOR_TOLERANCE = 2;

export type AppArtifact = { url: string; sha256: string; size?: number; kind: "dmg" | "app.tar.gz" | "nsis" | "deb" | "appimage" };
export type AppEntry = { version: string; notes?: string; pubDate?: string; platforms: Partial<Record<PlatformKey, AppArtifact>> };
export type ChannelManifest = { v: 1; channel: ChannelName; app?: AppEntry; server?: { version: string } };

export class ChannelError extends Error {
  constructor(message: string) { super(message); this.name = "ChannelError"; }
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;

export type Version = { major: number; minor: number; patch: number; pre: string };
export function parseVersion(v: string): Version | null {
  const m = SEMVER.exec(v);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? "" } : null;
}

function cmpPre(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  const x = a.split("."), y = b.split(".");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i], q = y[i];
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1; }
    else if (pn) return -1;
    else if (qn) return 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** Semver order: -1, 0, 1. A prerelease sorts before its release; beta.10 is after beta.9. Throws on text that is not a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new ChannelError(`not a version: ${!x ? a : b}`);
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return cmpPre(x.pre, y.pre) as -1 | 0 | 1;
}

/** The platform key for the shell's desktop_info (Rust OS and arch names): macos -> darwin, arm64 -> aarch64. */
export function platformKey(os: string, arch: string): PlatformKey | null {
  const o = os === "macos" ? "darwin" : os;
  const a = arch === "arm64" ? "aarch64" : arch === "amd64" ? "x86_64" : arch;
  const k = `${o}-${a}`;
  return (PLATFORMS as readonly string[]).includes(k) ? (k as PlatformKey) : null;
}

const KINDS = ["dmg", "app.tar.gz", "nsis", "deb", "appimage"] as const;

function artifact(p: string, raw: unknown): AppArtifact {
  if (typeof raw !== "object" || raw === null) throw new ChannelError(`${p}: not an artifact`);
  const r = raw as Record<string, unknown>;
  const url = r["url"], sha = r["sha256"], kind = r["kind"], size = r["size"];
  if (typeof url !== "string" || !/^https:\/\/[^\s]+$/.test(url)) throw new ChannelError(`${p}: url must be https`);
  if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) throw new ChannelError(`${p}: sha256 must be 64 lower-case hex characters`);
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) throw new ChannelError(`${p}: kind must be one of ${KINDS.join(", ")}`);
  if (size !== undefined && (typeof size !== "number" || !Number.isInteger(size) || size <= 0)) throw new ChannelError(`${p}: size must be a positive whole number`);
  const out: AppArtifact = { url, sha256: sha, kind: kind as AppArtifact["kind"] };
  if (size !== undefined) out.size = size;
  return out;
}

/** Reads a channel manifest. Strict about what an update would trust (https URLs, hashes, versions); a missing `app` or `server` part is fine, they ship separately. */
export function parseChannelManifest(text: string | unknown): ChannelManifest {
  let j: unknown = text;
  if (typeof text === "string") {
    if (text.length > 256 * 1024) throw new ChannelError("manifest is too large");
    try { j = JSON.parse(text); } catch { throw new ChannelError("manifest is not JSON"); }
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) throw new ChannelError("manifest is not an object");
  const r = j as Record<string, unknown>;
  if (r["v"] !== 1) throw new ChannelError("unknown manifest version");
  const channel = r["channel"];
  if (typeof channel !== "string" || !(CHANNELS as readonly string[]).includes(channel)) throw new ChannelError("channel must be stable, beta or nightly");
  const out: ChannelManifest = { v: 1, channel: channel as ChannelName };
  if (r["app"] !== undefined) {
    const a = r["app"];
    if (typeof a !== "object" || a === null) throw new ChannelError("app: not an object");
    const ar = a as Record<string, unknown>;
    const version = ar["version"];
    if (typeof version !== "string" || !parseVersion(version)) throw new ChannelError("app.version is not a version");
    const plats = ar["platforms"];
    if (typeof plats !== "object" || plats === null || Array.isArray(plats)) throw new ChannelError("app.platforms is not an object");
    const platforms: AppEntry["platforms"] = {};
    for (const [k, v] of Object.entries(plats as Record<string, unknown>)) {
      if (!(PLATFORMS as readonly string[]).includes(k)) throw new ChannelError(`app.platforms: unknown platform ${k}`);
      platforms[k as PlatformKey] = artifact(`app.platforms.${k}`, v);
    }
    const entry: AppEntry = { version, platforms };
    if (typeof ar["notes"] === "string") entry.notes = ar["notes"].slice(0, 2000);
    if (typeof ar["pubDate"] === "string") entry.pubDate = ar["pubDate"];
    out.app = entry;
  }
  if (r["server"] !== undefined) {
    const s = r["server"];
    const sv = typeof s === "object" && s !== null ? (s as Record<string, unknown>)["version"] : undefined;
    if (typeof sv !== "string" || !parseVersion(sv)) throw new ChannelError("server.version is not a version");
    out.server = { version: sv };
  }
  return out;
}

/** True when an app at `appVersion` and a server at `serverVersion` are within MINOR_TOLERANCE minor versions of each other (same major). */
export function appSupportedByServer(serverVersion: string, appVersion: string): boolean {
  const s = parseVersion(serverVersion), a = parseVersion(appVersion);
  if (!s || !a || s.major !== a.major) return false;
  return Math.abs(s.minor - a.minor) <= MINOR_TOLERANCE;
}

export type UpdateChoice = { version: string; artifact: AppArtifact; notes?: string } | null;

/**
 * The update to offer, or null: a newer app version than `current` that has an artifact for this platform and that the connected servers can use.
 * The server's own channel does not matter here (only its version, when `servers` names some); a manifest without an app part offers nothing.
 */
export function selectAppUpdate(m: ChannelManifest, q: { platform: PlatformKey; current: string; servers?: readonly string[] }): UpdateChoice {
  if (!m.app) return null;
  const art = m.app.platforms[q.platform];
  if (!art) return null;
  if (compareVersions(m.app.version, q.current) <= 0) return null;
  for (const sv of q.servers ?? []) if (!appSupportedByServer(sv, m.app.version)) return null;
  const choice: NonNullable<UpdateChoice> = { version: m.app.version, artifact: art };
  if (m.app.notes) choice.notes = m.app.notes;
  return choice;
}

/** The channel's manifest address under a base ("https://vyre.run/app/" + "stable" -> ".../stable.json"); the app channel has its own folder. */
export function manifestUrl(base: string, channel: ChannelName): string {
  if (!/^https:\/\//.test(base)) throw new ChannelError("the update address must be https");
  return `${base.replace(/\/+$/, "")}/${channel}.json`;
}
