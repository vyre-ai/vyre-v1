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
export const VERSION_FILES: readonly string[] = ["package.json"];

interface Found { file: string; version: string | undefined }

export function readVersions(root: string, files: readonly string[] = VERSION_FILES): Found[] {
  return files.map((file) => {
    const v = (JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as { version?: unknown }).version;
    return { file, version: typeof v === "string" ? v : undefined };
  });
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
    const text = fs.readFileSync(p, "utf8");
    const doc = JSON.parse(text) as Record<string, unknown>;
    doc["version"] = to;
    const indent = /^\{\n( +)"/.exec(text)?.[1]?.length ?? 2;
    fs.writeFileSync(p, `${JSON.stringify(doc, null, indent)}${text.endsWith("\n") ? "\n" : ""}`);
  }
  const left = versionProblems(root, files);
  if (left.length > 0) throw new Error(`after the bump: ${left.join("; ")}`);
  return { from, to };
}
