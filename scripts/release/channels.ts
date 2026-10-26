// The four release channels (spec b13): the app (rare), the server (auto-updates with backup and roll back), Kits and connectors (per Space, versioned), and the Chrome extension.
// They move independently: a release may update one and leave the others where they were. The feed therefore holds one signed entry per channel, any subset may be new, and a reader takes
// each entry on its own. The server channel's entry is the manifest the server already reads (modules/updates/handlers/channels.ts parseManifest).
import { releaseCounter } from "./version.ts";
import { signManifest, verifyManifest } from "./sign.ts";

export const CHANNEL_KINDS = ["app", "server", "kits", "extension"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const UPDATE_CHANNELS = ["stable", "beta", "nightly"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export interface ChannelRelease {
  version: string;
  /** Artifact file name inside the release and its sha256 (hex). */
  tarball: string;
  sha256: string;
  notes?: string;
  security?: boolean;
}

export type Releases = Partial<Record<ChannelKind, ChannelRelease>>;

export interface FeedEntry { kind: ChannelKind; channel: UpdateChannel; counter: number; manifest: string; signature: string }

const HEX64 = /^[0-9a-f]{64}$/;

function check(kind: ChannelKind, r: ChannelRelease): void {
  releaseCounter(r.version);   // throws on a version that is not a release version
  if (r.tarball === "" || r.tarball.includes("/") || r.tarball.includes("..")) throw new Error(`${kind}: the artifact name must be a plain file name`);
  if (!HEX64.test(r.sha256)) throw new Error(`${kind}: sha256 must be 64 hex characters`);
}

/**
 * The manifest text of one channel entry. The server channel carries the layout the server reads ({v, channel, server, apps}); the others carry the same shape under their own key, so every
 * entry is one JSON document with the version, the artifact and its hash, and nothing else.
 */
export function manifestFor(kind: ChannelKind, channel: UpdateChannel, r: ChannelRelease, apps: Readonly<Record<string, string>> = {}): string {
  check(kind, r);
  const body = { version: r.version, tarball: r.tarball, sha256: r.sha256, ...(r.notes === undefined ? {} : { notes: r.notes }), ...(r.security === true ? { security: true } : {}) };
  return JSON.stringify(kind === "server" ? { v: 1, channel, server: body, apps } : { v: 1, channel, kind, release: body });
}

/** One signed entry per channel that has a release; channels without one are left out, not filled in. */
export function buildEntries(o: { channel: UpdateChannel; releases: Releases; apps?: Readonly<Record<string, string>>; privateKeyPem: string; pinnedPublicKey: string | Uint8Array }): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const kind of CHANNEL_KINDS) {
    const r = o.releases[kind];
    if (r === undefined) continue;
    const manifest = manifestFor(kind, o.channel, r, o.apps);
    out.push({ kind, channel: o.channel, counter: releaseCounter(r.version), manifest, signature: signManifest(manifest, o.privateKeyPem, o.pinnedPublicKey) });
  }
  return out;
}

export interface Accepted { kind: ChannelKind; version: string; counter: number }

/**
 * Read a feed. Each entry stands alone: a bad signature or an entry whose counter is below what the reader already runs is refused for that channel only, and the other channels are
 * still accepted. Channels at different versions are normal (staggered releases), so nothing compares one channel to another.
 */
export function readFeed(entries: readonly FeedEntry[], o: { pinnedPublicKey: string | Uint8Array; running?: Partial<Record<ChannelKind, number>> }): { accepted: Accepted[]; refused: Array<{ kind: ChannelKind; reason: string }> } {
  const accepted: Accepted[] = [];
  const refused: Array<{ kind: ChannelKind; reason: string }> = [];
  for (const e of entries) {
    if (!verifyManifest(e.manifest, e.signature, o.pinnedPublicKey)) { refused.push({ kind: e.kind, reason: "bad signature" }); continue; }
    let version: string;
    try {
      const doc = JSON.parse(e.manifest) as { server?: { version?: unknown }; release?: { version?: unknown } };
      const v = (e.kind === "server" ? doc.server : doc.release)?.version;
      if (typeof v !== "string") throw new Error("no version");
      version = v;
    } catch { refused.push({ kind: e.kind, reason: "bad manifest" }); continue; }
    let counter: number;
    try { counter = releaseCounter(version); } catch { refused.push({ kind: e.kind, reason: "bad version" }); continue; }
    if (counter !== e.counter) { refused.push({ kind: e.kind, reason: "counter does not match the version" }); continue; }
    const running = o.running?.[e.kind];
    if (running !== undefined && counter < running) { refused.push({ kind: e.kind, reason: "older than what is running" }); continue; }
    accepted.push({ kind: e.kind, version, counter });
  }
  return { accepted, refused };
}
