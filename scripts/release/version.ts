// Release versions: the counter in a release's signed module list, and the bump of every file that carries the version. Ported from the 0.6 release-counter and bump-version scripts.
import fs from "node:fs";
import path from "node:path";

const RELEASE = /^(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.(\d+))?$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * A number that only ever goes up, made from the version alone (no state to forget or reset): it orders exactly as semver does, a prerelease below the release it leads to.
 * counter = ((major * 1000 + minor) * 1000 + patch) * 100 + phase; phase beta.N = N (1 to 39), rc.N = 40 + N (41 to 79), a release = 99.
 */
export function releaseCounter(version: string): number {
  const m = RELEASE.exec(String(version).replace(/^v/, ""));
  if (!m) throw new Error(`not a release version: ${version}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])] as const;
  if (major > 999 || minor > 999 || patch > 999) throw new Error(`version out of range: ${version}`);
  let phase = 99;
  if (m[4] !== undefined) {
    const n = Number(m[5]);
    if (!(n >= 1 && n <= 39)) throw new Error(`prerelease number out of range (1 to 39): ${version}`);
    phase = m[4] === "beta" ? n : 40 + n;
  }
  return ((major * 1000 + minor) * 1000 + patch) * 100 + phase;
}

/** Files that carry the release version, relative to the repo root. */
/** apps/app/public/whats-new.json is the release's What's new (scripts/changelog/assemble.ts): stamping it here means its lines are always for the version that ships them. */
/** The desktop app files too: rc.22 shipped a DMG named rc.21 because the Tauri files were not bumped. */
export const VERSION_FILES: readonly string[] = [
  "package.json",
  "apps/app/public/whats-new.json",
  "package-lock.json",
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/Cargo.lock",
];

/** One place in a file that holds the version. A plain .json file has one (its top-level version); the lockfiles and Cargo files have their own. */
interface Slot { label: string; get: (text: string) => string | undefined; set: (text: string, to: string) => string }

const CARGO_PACKAGE = /(\[package\][^[]*?\n\s*version\s*=\s*")([^"]*)(")/;
const CARGO_LOCK_DESKTOP = /(\[\[package\]\]\nname = "vyre-desktop"\nversion = ")([^"]*)(")/;

function jsonSlot(label: string, pick: (doc: Record<string, unknown>) => Record<string, unknown> | undefined): Slot {
  return {
    label,
    get: (text) => { const v = pick(JSON.parse(text) as Record<string, unknown>)?.["version"]; return typeof v === "string" ? v : undefined; },
    set: (text, to) => {
      const doc = JSON.parse(text) as Record<string, unknown>;
      const target = pick(doc);
      if (!target) throw new Error(`${label}: not found`);
      target["version"] = to;
      const indent = /^\{\n( +)"/.exec(text)?.[1]?.length ?? 2;
      return `${JSON.stringify(doc, null, indent)}${text.endsWith("\n") ? "\n" : ""}`;
    },
  };
}

function regexSlot(label: string, re: RegExp): Slot {
  return {
    label,
    get: (text) => re.exec(text)?.[2],
    set: (text, to) => { if (!re.test(text)) throw new Error(`${label}: not found`); return text.replace(re, `$1${to}$3`); },
  };
}

const lockPackages = (doc: Record<string, unknown>): Record<string, Record<string, unknown>> => (doc["packages"] ?? {}) as Record<string, Record<string, unknown>>;

function slotsOf(file: string): Slot[] {
  const base = path.basename(file);
  if (base === "package-lock.json") {
    return [
      jsonSlot("version", (d) => d),
      jsonSlot('packages[""].version', (d) => lockPackages(d)[""]),
      ...(file.startsWith("apps/desktop/") || !file.includes("/") ? [jsonSlot('packages["apps/desktop"].version', (d) => lockPackages(d)["apps/desktop"])] : []),
    ];
  }
  if (base === "Cargo.toml") return [regexSlot("[package] version", CARGO_PACKAGE)];
  if (base === "Cargo.lock") return [regexSlot("vyre-desktop version", CARGO_LOCK_DESKTOP)];
  return [jsonSlot("version", (d) => d)];
}

interface Found { file: string; version: string | undefined }

/** Every version a file carries, as one row per place (a lockfile has several). */
function readSlots(root: string, files: readonly string[]): Found[] {
  const out: Found[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const slots = slotsOf(file);
    for (const slot of slots) out.push({ file: slots.length > 1 ? `${file} ${slot.label}` : file, version: slot.get(text) });
  }
  return out;
}

export function readVersions(root: string, files: readonly string[] = VERSION_FILES): Found[] {
  return readSlots(root, files);
}

/** What disagrees with the first file. */
export function versionProblems(root: string, files: readonly string[] = VERSION_FILES): string[] {
  const all = readVersions(root, files);
  const want = all[0]?.version;
  return all.filter((x) => x.version !== want).map((x) => `${x.file} says ${x.version ?? "nothing"}, ${all[0]?.file ?? "the first file"} says ${want ?? "nothing"}`);
}

/** Set every version file to `to`. Only the version changes; indentation and the final newline are kept. */
export function bump(root: string, to: string, files: readonly string[] = VERSION_FILES): { from: string | undefined; to: string } {
  if (!VERSION.test(to)) throw new Error(`${to} is not a version (1.2.3 or 1.2.3-rc.1)`);
  const from = readVersions(root, files)[0]?.version;
  for (const file of files) {
    const p = path.join(root, file);
    let text = fs.readFileSync(p, "utf8");
    for (const slot of slotsOf(file)) text = slot.set(text, to);
    fs.writeFileSync(p, text);
  }
  const left = versionProblems(root, files);
  if (left.length > 0) throw new Error(`after the bump: ${left.join("; ")}`);
  return { from, to };
}

/** The version a release tag names: `v1.2.3` or `v1.2.3-rc.1` gives the text after the v; anything else is null. */
export function tagVersion(tag: string): string | null {
  const v = tag.replace(/^refs\/tags\//, "");
  if (!v.startsWith("v")) return null;
  try { releaseCounter(v); return v.slice(1); } catch { return null; }
}

/** Which update channel a version goes to: a release is stable, a beta or an rc goes to beta (the rolling `channel-beta` release). A nightly build is tagged `v1.2.3-nightly.N` is not a release version and is refused here. */
export function channelOfVersion(version: string): "stable" | "beta" {
  releaseCounter(version);
  return version.includes("-") ? "beta" : "stable";
}
