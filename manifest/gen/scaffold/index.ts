// vyre-gen new module <name> --lane <Lx> (ARCH 2.3 and 2.4): the module folder in the one shape every lane starts from, plus its manifest and its row in host/modules.json.
//   manifests/<name>.ts                 the declarations (one capability pair, one event, one entity): pure data, from tools/gen's scaffoldModule
//   modules/<name>/package.json         @vyre/mod-<name>, points at the manifest
//   modules/<name>/impl.ts              one stub handler per capability (the host serves them while status is 'stub')
//   modules/<name>/projections.ts       reducers (inline) and consumers (async): none yet
//   modules/<name>/migrations/0001_init.sql    the module's own tables, prefixed <name>_
//   modules/<name>/tests/*.test.ts      a contract test (handlers match the manifest) and a seeded-Space test (skips until the testkit lands)
//   modules/<name>/fixtures/seed.ts     rows for the seeded Space
//   modules/<name>/README.md            ten lines at most
// Nothing here overwrites: a folder, a manifest or a registry row that exists is an error.
import fs from "node:fs";
import path from "node:path";
import { scaffoldModule } from "../../../tools/gen/src/scaffold.ts";

export interface ScaffoldFile { path: string; content: string }
export interface ModuleRow { id: string; owner: string; status: string }
export interface ModulesFile { note?: string; modules: ModuleRow[] }

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error(`module name must be kebab case: ${name}`);
}

/** The files of a new module, as repo-relative paths and contents. Pure. */
export function scaffoldFiles(name: string, lane: string): ScaffoldFile[] {
  checkName(name);
  const { manifestSource } = scaffoldModule(name, lane);
  const noun = name.replace(/-/g, "_");
  const table = `${noun}_item`;
  const dir = `modules/${name}`;
  const files: ScaffoldFile[] = [];
  const add = (p: string, content: string): void => { files.push({ path: p, content }); };

  add(`manifests/${name}.ts`, manifestSource);
  add(`${dir}/package.json`, JSON.stringify({ name: `@vyre/mod-${name}`, version: "0.0.0", private: true, type: "module", vyre: { manifest: `../../manifests/${name}.ts` } }, null, 2) + "\n");
  add(`${dir}/impl.ts`, `// ${name} (lane ${lane}): one handler per capability of manifests/${name}.ts. Handlers are the only place logic lives.
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export const handlers = {
  ${JSON.stringify(`${noun}.get`)}: async (_ctx: Ctx, input: { id: string }): Promise<{ name: string }> => ({ name: input.id }),
  ${JSON.stringify(`${noun}.create`)}: async (ctx: Ctx, input: { name: string }): Promise<{ id: string }> => {
    const id = \`${noun.slice(0, 3).padEnd(3, "x")}_\${ctx.now().toString(36)}\`;
    ctx.emit(${JSON.stringify(`${noun}.created`)} as never, id, { id });
    return { id };
  },
};
export const projections = {};
export const codecs = {};
`);
  add(`${dir}/projections.ts`, `// ${name}: reducers (inline, same transaction as the append) and consumers (async, durable cursor). None yet.
export const inline = {};
export const consumers = {};
`);
  add(`${dir}/migrations/0001_init.sql`, `-- ${name}: the module's own tables, prefixed ${noun}_.
CREATE TABLE IF NOT EXISTS ${table} (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);
  add(`${dir}/fixtures/seed.ts`, `// ${name}: rows for the seeded Space. The \`small\` recipe imports every module's seed by glob.
export const seed = { table: ${JSON.stringify(table)}, rows: [] as { id: string; name: string; created_at: number }[] };
`);
  add(`${dir}/tests/${name}.contract.test.ts`, `// ${name}: the handlers cover exactly the capabilities the manifest declares.
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/${name}.ts";
import { handlers } from "../impl.ts";

test(${JSON.stringify(`${name}: one handler per capability, and every emitted event is declared`)}, () => {
  assert.deepEqual(Object.keys(handlers).sort(), manifest.capabilities.map((c) => c.name).sort());
  const events = new Set((manifest.events ?? []).map((e) => e.name));
  for (const c of manifest.capabilities) for (const e of c.emits ?? []) assert.ok(events.has(e), \`\${c.name} emits \${e}, which the manifest declares\`);
  assert.equal(manifest.owner, ${JSON.stringify(lane)});
});
`);
  add(`${dir}/tests/${name}.space.test.ts`, `// ${name}: through the seeded Space. Skips until the testkit (testkit/src/api.ts) exists, then runs without edits.
import test from "node:test";
import assert from "node:assert/strict";

const kit = await import("../../../testkit/src/api.ts").catch(() => null) as { createTestSpace?: (o: { seed: string }) => Promise<{ call(cap: string, input: unknown): Promise<unknown>; close(): Promise<void> }> } | null;

test(${JSON.stringify(`${name}: create then get through createTestSpace`)}, { skip: !kit?.createTestSpace }, async () => {
  const space = await kit!.createTestSpace!({ seed: "small" });
  try {
    const made = await space.call(${JSON.stringify(`${noun}.create`)}, { name: "first" }) as { id: string };
    assert.deepEqual(await space.call(${JSON.stringify(`${noun}.get`)}, { id: made.id }), { name: "first" });
  } finally { await space.close(); }
});
`);
  add(`${dir}/README.md`, `# ${name}

Owner: lane ${lane}. Status: stub (the host serves the stub handlers until the manifest says live).
Scope: replace this line with what the module is for.
Call: \`${noun}.create\`, \`${noun}.get\` (see manifests/${name}.ts).
Tables: \`${table}\` (migrations/0001_init.sql).
Tests: tests/ (contract test, seeded-Space test).
`);
  return files;
}

/** Add a row to the text of host/modules.json, keeping the rows sorted by id. Refuses a repeat. */
export function registerModule(text: string, row: ModuleRow): string {
  const file = JSON.parse(text) as ModulesFile;
  if (file.modules.some((m) => m.id === row.id)) throw new Error(`module ${row.id} is already in host/modules.json`);
  file.modules = [...file.modules, row].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(file, null, 2) + "\n";
}

export interface WriteResult { written: string[]; row: ModuleRow }
/**
 * Write a new module under `root` and register it. `root` is the repo root (it holds scripts/lanes.json and host/modules.json). The lane must exist in lanes.json.
 * Everything is checked before anything is written.
 */
export function writeScaffold(root: string, name: string, lane: string): WriteResult {
  checkName(name);
  const lanes = (JSON.parse(fs.readFileSync(path.join(root, "scripts/lanes.json"), "utf8")) as { lanes: { id: string }[] }).lanes.map((l) => l.id);
  if (!lanes.includes(lane)) throw new Error(`unknown lane ${lane}; lanes are ${lanes.join(", ")}`);
  const files = scaffoldFiles(name, lane);
  for (const f of files) if (fs.existsSync(path.join(root, f.path))) throw new Error(`${f.path} already exists; a scaffold never overwrites`);
  const modulesPath = path.join(root, "host/modules.json");
  const row: ModuleRow = { id: name, owner: lane, status: "stub" };
  const updated = registerModule(fs.readFileSync(modulesPath, "utf8"), row);
  for (const f of files) { const p = path.join(root, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.content, { flag: "wx" }); }
  fs.writeFileSync(modulesPath, updated);
  return { written: files.map((f) => f.path), row };
}
