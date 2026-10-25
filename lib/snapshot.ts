// Frozen contract snapshots (docs/frozen/snapshots): one small file per manifest holding the hash of each of its capabilities and events.
//
// Why per manifest and not one hash for the registry: a single global hash (or count, or per-lane table) changes with every contract change, so every contract PR conflicted with every other
// and they had to merge one at a time. A snapshot file only changes when that manifest's contract changes, so two PRs that touch different manifests merge in either order with nothing to
// re-record. Two PRs that change the same manifest still conflict, which is right: they changed the same contract.
//
// The files are written by the regen bot (node tools/gen/src/cli.ts --snapshots) and committed with the PR, so a change to a frozen capability or event shows up in review as a diff of that
// capability's line. The frozen tests recompute them from generated/registry.json and fail on any difference, missing file or stray file.
import { createHash } from "node:crypto";
import { canonical } from "./canonical.ts";

export interface SnapshotRegistry {
  $defs?: Record<string, unknown>;
  modules: ReadonlyArray<{ id: string }>;
  capabilities: ReadonlyArray<{ name: string; v: number; module: string }>;
  events: ReadonlyArray<{ name: string; module: string }>;
}

export const SNAPSHOT_DIR = "docs/frozen/snapshots";

/**
 * The registry shares repeated schema subtrees through $defs, and what is shared depends on every other capability. A snapshot hashes the capability with its references resolved, so it changes
 * only when that capability's own contract changes (a new capability elsewhere can turn a subtree into a shared one without touching this one).
 */
function resolve(v: unknown, defs: Record<string, unknown>, stack: readonly string[] = []): unknown {
  if (Array.isArray(v)) return v.map((x) => resolve(x, defs, stack));
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const ref = o["$ref"];
    if (typeof ref === "string" && ref.startsWith("#/$defs/")) {
      const key = ref.slice("#/$defs/".length);
      if (stack.includes(key) || defs[key] === undefined) return v;   // a cycle or an unknown name stays as written
      return resolve(defs[key], defs, [...stack, key]);
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, resolve(x, defs, stack)]));
  }
  return v;
}

const sha = (v: unknown, defs: Record<string, unknown>): string => createHash("sha256").update(canonical(resolve(v, defs))).digest("hex");

/** The snapshot files of a registry: path (relative to the repo root) to text. Sorted keys and one entry per line, so a change to one capability is a one line diff. */
export function snapshotFiles(reg: SnapshotRegistry): Map<string, string> {
  const out = new Map<string, string>();
  const defs = reg.$defs ?? {};
  for (const m of reg.modules) {
    const caps = reg.capabilities.filter((c) => c.module === m.id).sort((a, b) => (a.name === b.name ? a.v - b.v : a.name < b.name ? -1 : 1));
    const events = reg.events.filter((e) => e.module === m.id).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const section = (name: string, rows: string[]): string => (rows.length ? `  "${name}": {\n${rows.join(",\n")}\n  }` : `  "${name}": {}`);
    out.set(
      `${SNAPSHOT_DIR}/${m.id}.json`,
      [
        "{",
        `  "module": ${JSON.stringify(m.id)},`,
        `${section("capabilities", caps.map((c) => `    ${JSON.stringify(`${c.name}@${c.v}`)}: ${JSON.stringify(sha(c, defs))}`))},`,
        section("events", events.map((e) => `    ${JSON.stringify(e.name)}: ${JSON.stringify(sha(e, defs))}`)),
        "}",
        "",
      ].join("\n"),
    );
  }
  return out;
}

/** What differs between the snapshots a repo has and the ones its registry gives: missing, changed and stray files, by name. `have` maps repo-relative paths to text. */
export function snapshotDrift(reg: SnapshotRegistry, have: ReadonlyMap<string, string>): string[] {
  const want = snapshotFiles(reg);
  const drift: string[] = [];
  for (const [p, text] of want) {
    const got = have.get(p);
    if (got === undefined) drift.push(`missing  ${p}`);
    else if (got !== text) drift.push(`changed  ${p}${changedKeys(got, text)}`);
  }
  for (const p of have.keys()) if (!want.has(p)) drift.push(`stray    ${p}`);
  return drift;
}

/** The capability or event names whose line differs, so a failure says what changed, not only which file. */
function changedKeys(had: string, want: string): string {
  const lines = (t: string): Map<string, string> => new Map(t.split("\n").filter((l) => l.startsWith('    "')).map((l) => [l.split('":')[0] as string, l]));
  const a = lines(had), b = lines(want);
  const keys = new Set<string>([...a.keys(), ...b.keys()]);
  const diff = [...keys].filter((k) => a.get(k) !== b.get(k)).map((k) => k.trim().slice(1));
  return diff.length ? ` (${diff.slice(0, 8).join(", ")}${diff.length > 8 ? `, and ${diff.length - 8} more` : ""})` : "";
}
