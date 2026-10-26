// Where releases are published (lead decision, 26 Oct): the signed manifests are assets of the GitHub Releases of vyre-ai/vyre-v1 (a public repo); v1 has no vyre.run dependency. The server's
// updater and the Linux installer (scripts/install/linux/install.sh) read `<base>/<channel>.json` and `<base>/<channel>.json.sig` and take the artifact named in the manifest relative to
// the same base, so a release attaches exactly those names. The other channels (app, kits, extension) get `<channel>-<kind>.json[.sig]` beside them.
import type { ChannelKind, FeedEntry, UpdateChannel } from "./channels.ts";

export const RELEASE_REPO = "vyre-ai/vyre-v1";

/** The `VYRE_UPDATE_URL` a channel is read from. Stable is the newest published release; beta and nightly are rolling releases with a fixed tag, because "latest" never points at a prerelease. */
export function feedBase(channel: UpdateChannel, repo: string = RELEASE_REPO): string {
  return channel === "stable" ? `https://github.com/${repo}/releases/latest/download/` : `https://github.com/${repo}/releases/download/channel-${channel}/`;
}

/** The release assets one signed entry becomes: the manifest text and its detached signature, under the names the installer and the updater read. */
export function assetsFor(e: FeedEntry): Array<{ name: string; content: string }> {
  const stem = e.kind === "server" ? `${e.channel}.json` : `${e.channel}-${e.kind}.json`;
  return [{ name: stem, content: e.manifest }, { name: `${stem}.sig`, content: `${e.signature}\n` }];
}

export const assetKinds = (entries: readonly FeedEntry[]): ChannelKind[] => entries.map((e) => e.kind);
