// The version Chrome reads from an extension's manifest. Chrome takes one to four dot-separated integers (each 0 to 65535) in `version` and nothing else; a release such as 1.0.0-rc.3 goes in
// `version_name`, which Chrome shows as it is. A prerelease number becomes the fourth integer (1.0.0-rc.3 is 1.0.0.3), so every release candidate has its own version. Used by the release pack
// (scripts/release/pack.ts) and by the desktop bundle (apps/desktop/src-tauri/stage-runtime.ts), so the zip people load and the folder the app installs say the same thing.
const RELEASE = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-([0-9A-Za-z.-]+))?$/;

export function chromeVersion(release: string): { version: string; version_name: string } {
  const m = RELEASE.exec(release);
  if (!m) throw new Error(`"${release}" is not a release version (1.2.3 or 1.2.3-rc.4)`);
  const core = [m[1], m[2], m[3]].map(Number);
  if (core.some((n) => n > 65535)) throw new Error(`"${release}" has a part above 65535, which Chrome does not accept`);
  if (m[4] === undefined) return { version: core.join("."), version_name: release };
  const last = /(\d+)$/.exec(m[4]);
  const n = last ? Number(last[1]) : 0;
  if (n > 65535) throw new Error(`"${release}" has a prerelease number above 65535, which Chrome does not accept`);
  return { version: [...core, n].join("."), version_name: release };
}

/** The extension's manifest text with the release's version written in. Everything else in it is kept as it is. */
export function withReleaseVersion(manifestText: string, release: string): string {
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const v = chromeVersion(release);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(manifest)) {
    if (k === "version") { out["version"] = v.version; out["version_name"] = v.version_name; } else if (k !== "version_name") out[k] = val;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}
