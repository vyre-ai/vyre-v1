// Test selection for CI (ARCH 10.2, 10.6). Wraps the import-graph walk in scripts/ci-select.mjs and adds the manifest edge:
// a change under manifests/ selects the generated contract tests for that module and every consumer of its generated outputs.
// Rules kept from the walk: a changed or added test file always runs; a changed code file reached by no test is "uncovered" and fails.
//   node scripts/ci-select.ts <base-ref> [--matrix [--max N]]   prints {"all","files","why","uncovered","edges"}; exit 1 when a code file is uncovered
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { select as walk } from "./ci-select.mjs";
import { CODE, TEST } from "./lib/graph.mjs";
import { shardFiles, toMatrix } from "./shard.ts";

export type Selection = { all: boolean; files: string[]; why: string[]; uncovered: string[]; edges: string[] };
type Input = { changed: string[]; tracked: Set<string>; read: (f: string) => string };

/** Generated files a manifest file produces. Module manifests map to generated/modules/<name>/ and generated/tests/<name>.*; shared manifests map to all generated code. */
export function manifestEdges(changed: string[], tracked: Set<string>): string[] {
  const out = new Set<string>();
  const generated = [...tracked].filter((f) => f.startsWith("generated/") && CODE.test(f));
  for (const f of changed) {
    const m = /^manifests\/([^/]+?)(?:\.ts|\/.*)?$/.exec(f);
    if (!m) continue;
    const name = m[1]!;
    const own = generated.filter((g) => g.startsWith(`generated/modules/${name}/`) || g.startsWith(`generated/tests/${name}.`));
    for (const g of own.length ? own : generated) out.add(g);
  }
  return [...out].sort();
}

/** A change here always runs every frozen-* test (lead requirement), whatever the import walk says. */
export const FROZEN_TRIGGER = /^(manifests\/|packages\/contracts\/|tools\/gen\/|generated\/|docs\/frozen\/)/;
export const FROZEN_TEST = /(^|\/)frozen-[^/]*\.test\.[cm]?[jt]s$/;

/** The unit a path belongs to: modules/<m>/, packages/<p>/, or a whole top-level host, kernel, sync or agent tree. Null for anything else. */
export function unitOf(f: string): string | null {
  const m = /^(modules|packages)\/([^/]+)\//.exec(f);
  if (m) return `${m[1]}/${m[2]}/`;
  const t = /^(host|kernel|sync|agent)\//.exec(f);
  return t ? `${t[1]}/` : null;
}

/** Every test file in the unit of each changed path (deleted paths included), so a same-module test never rests stale. */
export function unitTests(changed: string[], tracked: Set<string>): string[] {
  const units = new Set<string>();
  for (const f of changed) { const u = unitOf(f); if (u && !/\.md$/.test(f)) units.add(u); }
  if (!units.size) return [];
  return [...tracked].filter((f) => TEST.test(f) && [...units].some((u) => f.startsWith(u))).sort();
}

/**
 * Booted-daemon tests (host/tests/*.test.ts that call startDaemon) load the modules they boot by file name at run time, so the import walk never sees a module as their
 * dependency. A change under modules/<m>/ selects every such test that boots <m>: one that has an `// @reads /modules/<m>/` line, or that names <m> as a quoted module id
 * (an id list such as `const L6 = ["tasks", ...]`, or `m.id === "kits"`).
 */
export function bootedTests(changed: string[], tracked: Set<string>, read: (f: string) => string): string[] {
  const touched = new Set<string>();
  for (const f of changed) { const m = /^modules\/([^/]+)\//.exec(f); if (m && !/\.md$/.test(f)) touched.add(m[1]!); }
  if (!touched.size) return [];
  const ids = new Set<string>();
  for (const f of tracked) { const m = /^modules\/([^/]+)\//.exec(f); if (m) ids.add(m[1]!); }
  const out: string[] = [];
  for (const f of [...tracked].sort()) {
    if (!/^host\/tests\/[^/]+\.test\.[cm]?[jt]s$/.test(f)) continue;
    let src: string;
    try { src = read(f); } catch { continue; }
    if (!/\bstartDaemon\b/.test(src)) continue;
    const boots = new Set<string>();
    for (const m of src.matchAll(/^\s*\/\/\s*@reads\s+\/modules\/([^/\s]+)\//gm)) boots.add(m[1]!);
    for (const m of src.matchAll(/["']([a-z][a-z0-9-]*)["']/g)) if (ids.has(m[1]!)) boots.add(m[1]!);
    if ([...touched].some((t) => boots.has(t))) out.push(f);
  }
  return out;
}

/** Directory a non-literal dynamic import (template or concatenation) can load from, repo-relative, or null. */
const DYNAMIC = [/\bimport\(\s*`([^`$]*)\$\{/g, /\bimport\(\s*(?:'([^']*)'|"([^"]*)")\s*\+/g];
export function dynamicDirs(from: string, src: string): string[] {
  const out = new Set<string>();
  for (const re of DYNAMIC) for (const m of src.matchAll(re)) {
    const prefix = m[1] ?? m[2] ?? m[3] ?? "";
    if (!prefix.startsWith(".")) continue;
    const dir = prefix.endsWith("/") ? prefix : prefix.slice(0, prefix.lastIndexOf("/") + 1);
    out.add(path.posix.normalize(path.posix.join(path.posix.dirname(from), dir || ".")).replace(/\/$/, ""));
  }
  return [...out];
}

/** The walk plus the manifest edge, the unit rule, deleted files and dynamic imports. Test files in the diff are always selected, even when the walk returns early. */
export function selectAffected({ changed, tracked, read }: Input): Selection {
  const edges = manifestEdges(changed, tracked);
  // A deleted code file stays a node in the graph so the files that still import it are selected as its dependents.
  const deleted = changed.filter((f) => !tracked.has(f) && CODE.test(f));
  const nodes = deleted.length ? new Set([...tracked, ...deleted]) : tracked;
  // A non-literal dynamic import depends on every file in the directory it loads from (an @reads line per file).
  const cache = new Map<string, string>();
  const readDyn = (f: string): string => {
    const hit = cache.get(f);
    if (hit !== undefined) return hit;
    const src = read(f);
    let extra = "";
    if (CODE.test(f) && /\bimport\(\s*[`'"]/.test(src)) {
      for (const dir of dynamicDirs(f, src)) for (const g of nodes) if (g !== f && CODE.test(g) && path.posix.dirname(g) === dir) extra += `\n// @reads /${g}`;
    }
    cache.set(f, src + extra);
    return src + extra;
  };
  const raw = walk({ changed: [...new Set([...changed, ...edges])], tracked: nodes, read: readDyn }) as Omit<Selection, "edges">;
  const r = { ...raw, files: raw.files.filter((f) => tracked.has(f)), uncovered: raw.uncovered.filter((f) => tracked.has(f)) };
  const own = changed.filter((f) => tracked.has(f) && TEST.test(f));
  const uncovered = r.uncovered.filter((f) => changed.includes(f) && !(f.startsWith("manifests/") && edges.length && r.files.length));
  const why = edges.length ? [...r.why, `manifest edge: ${edges.length} generated files`] : r.why;
  if (r.all) return { ...r, why, edges };
  const frozen = changed.some((f) => FROZEN_TRIGGER.test(f)) ? [...tracked].filter((f) => FROZEN_TEST.test(f)) : [];
  if (frozen.length) why.push(`frozen trigger: ${frozen.length} frozen-* tests always run`);
  const unit = unitTests(changed, tracked);
  if (unit.length) why.push(`unit rule: ${unit.length} tests in the changed module or package`);
  const booted = bootedTests(changed, tracked, read);
  if (booted.length) why.push(`booted-daemon rule: ${booted.length} tests that boot a changed module`);
  return { ...r, why, uncovered, files: [...new Set([...r.files, ...own, ...frozen, ...unit, ...booted])].sort(), edges };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const repo = path.resolve(path.dirname(self), "..");
  const git = (a: string[]) => { const r = spawnSync("git", a, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout; };
  const base = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
  let result: Selection;
  let tracked = new Set<string>();
  try { tracked = new Set(git(["ls-files"]).split("\n").filter(Boolean)); } catch {}
  try {
    if (!base || /^0+$/.test(base)) throw new Error("no base");
    const changed = git(["diff", "--name-only", "--no-renames", `${base}...HEAD`]).split("\n").filter(Boolean);
    result = selectAffected({ changed, tracked, read: (f) => fs.readFileSync(path.join(repo, f), "utf8") });
  } catch (e: any) {
    result = { all: true, files: [], why: [`could not tell what changed (${String(e.message).split("\n")[0]}): running everything`], uncovered: [], edges: [] };
  }
  if (process.argv.includes("--matrix")) {
    const mi = process.argv.indexOf("--max");
    const maxArg = mi > 0 ? Number(process.argv[mi + 1]) : 0;
    const files = result.all ? [...tracked].filter((f) => TEST.test(f)) : result.files;
    const timings = JSON.parse(fs.readFileSync(path.join(repo, "test/timings.json"), "utf8"));
    const slow = JSON.parse(fs.readFileSync(path.join(repo, "test/slow.json"), "utf8"));
    console.log(JSON.stringify({ ...result, matrix: toMatrix(shardFiles(files, timings, slow, maxArg ? { max: maxArg } : {})) }));
  } else console.log(JSON.stringify(result));
  if (!result.all && result.uncovered.length) { for (const f of result.uncovered) console.error(`no test covers ${f}`); process.exit(1); }
}
