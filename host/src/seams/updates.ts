// The host side of the updates module going live (P-L7b_17, rulings 31 and 32): the pinned release key, the release feed and the installer.
// Layer rule (boundaries.json): host never imports a module, so the module gets these through `hostSeams.configureUpdates`; the daemon registers `createUpdatesHost` under that name.
//
//   key        the Ed25519 public half of the release signing key, compiled in (RELEASE_PUBLIC_KEY_HEX; `node scripts/release/cli.ts pubkey` prints it from the release environment).
//              It is a constant on purpose: an environment variable or a file would let whoever can change them point the server at their own releases. With none compiled in
//              the feed refuses every read, so a build without the key can never install anything.
//   feed       the signed manifests attached to the GitHub Releases of vyre-ai/vyre-v1 (scripts/release/feed.ts): `<channel>.json` and `<channel>.json.sig` under the channel's base address.
//              stable is the newest published release; beta and nightly are rolling releases with a fixed tag, because "latest" never points at a prerelease.
//   installer  the repo's own `vyre-server` command (scripts/install/linux/vyre-server): update, rollback, version and doctor. It re-reads and re-verifies the signed manifest itself,
//              backs the data up, checks health and rolls back on failure; this seam only starts it and reports.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

/** The release public key, 64 hex characters. Filled from the release job's `pubkey` output when the first release key exists. */
export const RELEASE_PUBLIC_KEY_HEX = "a21dbf67e93e65718d45529896455e13a4cb296b77f872b7af19ba81b094e8fa";
export const RELEASE_REPO = "vyre-ai/vyre-v1";

export type UpdateChannel = "stable" | "beta" | "nightly";
export interface SignedManifest { manifest: string; signature: string }
export interface ReleaseInfo { version: string; tarball: string; sha256: string; notes?: string; security?: boolean }

/** The shape the updates module takes in configureUpdates (modules/updates/handlers/channels.ts UpdateDrivers). */
export interface UpdatesDrivers {
  feed: { fetch(channel: UpdateChannel): Promise<SignedManifest> };
  releaseKey: Uint8Array;
  installer: {
    current(): Promise<string>;
    previous(): Promise<string[]>;
    install(release: ReleaseInfo, channel?: UpdateChannel): Promise<void>;
    healthy(): Promise<boolean>;
    switchTo(version: string): Promise<void>;
  };
}

export type FeedFetch = (url: string) => Promise<{ status: number; text(): Promise<string> }>;
export type RunResult = { code: number; stdout: string; stderr: string };
export type RunCommand = (argv: readonly string[]) => Promise<RunResult>;

export interface UpdatesHostDeps {
  /** Public key as 64 hex characters. Default: the compiled-in constant. Tests pass their own. */
  releaseKeyHex?: string;
  /** Base address of a channel's feed. Default: GitHub Releases of vyre-ai/vyre-v1. */
  feedBase?: (channel: UpdateChannel) => string;
  fetch?: FeedFetch;
  /** Run `vyre-server ...`. Default: the command on PATH. */
  run?: RunCommand;
  /** The install folder (VYRE_DIR), where `previous` names the release to go back to. Default: $VYRE_DIR or /srv/vyre. */
  dir?: string;
  /** Read a small text file; null when it is not there. Default: the file system. */
  readText?: (file: string) => string | null;
}

/** `vyre-server`'s base address for a channel, as scripts/release/feed.ts (feedBase) writes it. */
export function githubFeedBase(channel: UpdateChannel, repo: string = RELEASE_REPO): string {
  return channel === "stable" ? `https://github.com/${repo}/releases/latest/download/` : `https://github.com/${repo}/releases/download/channel-${channel}/`;
}

const defaultFetch: FeedFetch = async (url) => {
  // GitHub answers an asset with a redirect to its storage; the signature check, not the address, is what makes the content trusted.
  const r = await globalThis.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  return { status: r.status, text: () => r.text() };
};

const defaultRun: RunCommand = (argv) => new Promise((resolve) => {
  const [cmd, ...args] = argv;
  execFile(cmd ?? "vyre-server", args, { timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ code: err === null ? 0 : typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1, stdout: String(stdout), stderr: String(stderr) });
  });
});

const defaultRead = (file: string): string | null => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };

const hexToBytes = (hex: string): Uint8Array | null => (/^[0-9a-f]{64}$/i.test(hex) ? new Uint8Array(Buffer.from(hex, "hex")) : null);

export function createUpdatesHost(d: UpdatesHostDeps = {}): UpdatesDrivers {
  const key = hexToBytes(d.releaseKeyHex ?? RELEASE_PUBLIC_KEY_HEX);
  const base = d.feedBase ?? githubFeedBase;
  const doFetch = d.fetch ?? defaultFetch;
  const run = d.run ?? defaultRun;
  const read = d.readText ?? defaultRead;
  const dir = d.dir ?? process.env["VYRE_DIR"] ?? "/srv/vyre";
  const server = (...args: string[]): Promise<RunResult> => run(["vyre-server", ...args]);

  return {
    // An all-zero key verifies nothing: with no key compiled in, every manifest fails the module's signature check instead of any being trusted.
    releaseKey: key ?? new Uint8Array(32),
    feed: {
      async fetch(channel) {
        if (key === null) throw new Error("this build has no release key compiled in, so it cannot read a release feed");
        const root = base(channel).replace(/\/?$/, "/");
        const [m, s] = await Promise.all([doFetch(`${root}${channel}.json`), doFetch(`${root}${channel}.json.sig`)]);
        if (m.status !== 200) throw new Error(`the ${channel} manifest answered ${m.status}`);
        if (s.status !== 200) throw new Error(`the ${channel} signature answered ${s.status}`);
        return { manifest: await m.text(), signature: (await s.text()).trim() };
      },
    },
    installer: {
      async current() {
        const r = await server("version");
        if (r.code !== 0 || r.stdout.trim() === "") throw new Error("vyre-server could not say which version is running");
        return r.stdout.trim();
      },
      // vyre-server keeps one earlier release to go back to: the `previous` link in the install folder.
      async previous() {
        const text = read(path.join(dir, "previous"));
        const v = text === null ? null : /^releases\/(\S+)/m.exec(text)?.[1] ?? null;
        return v === null ? [] : [v];
      },
      async install(release, channel = 'stable') {
        const r = await server("update", "--yes", "--channel", channel, "--version", release.version, "--sha256", release.sha256, "--feed-base", base(channel));
        if (r.code !== 0) throw new Error(firstLine(r.stderr) || `vyre-server update failed (${r.code})`);
        const now = await this.current();
        if (now !== release.version) throw new Error(`vyre-server installed ${now}, not ${release.version}`);
      },
      async healthy() {
        return (await server("doctor", "--quiet")).code === 0;
      },
      async switchTo(version) {
        // vyre-server update rolls itself back when an install fails, so the server may already be on the version asked for.
        if ((await this.current()) === version) return;
        const kept = await this.previous();
        if (!kept.includes(version)) throw new Error(`${version} is not the release kept to go back to`);
        const r = await server("rollback");
        if (r.code !== 0) throw new Error(firstLine(r.stderr) || `vyre-server rollback failed (${r.code})`);
      },
    },
  };
}

const firstLine = (s: string): string => s.trim().split("\n")[0]?.slice(0, 300) ?? "";
