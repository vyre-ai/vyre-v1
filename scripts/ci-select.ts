// Test selection for CI (ARCH 10.2, 10.6). Wraps the import-graph walk in scripts/ci-select.mjs and adds the manifest edge:
// a change under manifests/ selects the generated contract tests for that module and every consumer of its generated outputs.
// Rules kept from the walk: a changed or added test file always runs; a changed code file reached by no test is "uncovered" and fails.
//   node scripts/ci-select.ts <base-ref> [--matrix]   prints {"all","files","why","uncovered","edges"}; exit 1 when a code file is uncovered
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

/** The walk plus the manifest edge. Test files in the diff are always selected, even when the walk returns early. */
export function selectAffected({ changed, tracked, read }: Input): Selection {
  const edges = manifestEdges(changed, tracked);
  const r = walk({ changed: [...new Set([...changed, ...edges])], tracked, read }) as Omit<Selection, "edges">;
  const own = changed.filter((f) => tracked.has(f) && TEST.test(f));
  const uncovered = r.uncovered.filter((f) => changed.includes(f));
  const why = edges.length ? [...r.why, `manifest edge: ${edges.length} generated files`] : r.why;
  if (r.all) return { ...r, why, edges };
  return { ...r, why, uncovered, files: [...new Set([...r.files, ...own])].sort(), edges };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const repo = path.resolve(path.dirname(self), "..");
  const git = (a: string[]) => { const r = spawnSync("git", a, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout; };
  const base = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
  let result: Selection;
  let tracked = new Set<string>();
  try {
    if (!base || /^0+$/.test(base)) throw new Error("no base");
    tracked = new Set(git(["ls-files"]).split("\n").filter(Boolean));
    const changed = git(["diff", "--name-only", "--no-renames", `${base}...HEAD`]).split("\n").filter(Boolean);
    result = selectAffected({ changed, tracked, read: (f) => fs.readFileSync(path.join(repo, f), "utf8") });
  } catch (e: any) {
    result = { all: true, files: [], why: [`could not tell what changed (${String(e.message).split("\n")[0]}): running everything`], uncovered: [], edges: [] };
  }
  if (process.argv.includes("--matrix")) {
    const files = result.all ? [...tracked].filter((f) => TEST.test(f)) : result.files;
    const timings = JSON.parse(fs.readFileSync(path.join(repo, "test/timings.json"), "utf8"));
    const slow = JSON.parse(fs.readFileSync(path.join(repo, "test/slow.json"), "utf8"));
    console.log(JSON.stringify({ ...result, matrix: toMatrix(shardFiles(files, timings, slow)) }));
  } else console.log(JSON.stringify(result));
  if (!result.all && result.uncovered.length) { for (const f of result.uncovered) console.error(`no test covers ${f}`); process.exit(1); }
}
