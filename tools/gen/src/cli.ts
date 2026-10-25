// vyre-gen: node tools/gen/src/cli.ts [--check] [--out <dir>] [--summary]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from './build.ts';
import { emitAll, summary } from './emit.ts';
import { loadManifests } from './load.ts';
import { diffRegistries } from './diff.ts';
import { dedupeRegistry } from './dedupe.ts';
import { SNAPSHOT_DIR, snapshotFiles } from '../../../lib/snapshot.ts';
import type { Registry } from '../../../packages/contracts/src/index.ts';
import { validateAll } from './validate.ts';
import type { LaneTable } from './validate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const diffIdx = args.indexOf('--diff-against');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? resolve(String(args[outIdx + 1])) : join(root, 'generated');

function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const res: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) res.push(...walk(p, base));
    else res.push(relative(base, p).split('\\').join('/'));
  }
  return res;
}

if (args[0] === 'new' && args[1] === 'module') {
  // vyre-gen new module <name> --lane <Lx>: writes manifests/<name>.ts and registers the module in host/modules.json and tools/gen/lanes.json
  const { scaffoldModule } = await import('./scaffold.ts');
  const name = String(args[2]);
  const lane = String(args[args.indexOf('--lane') + 1]);
  const { manifestSource, registryRow } = scaffoldModule(name, lane);
  writeFileSync(join(root, 'manifests', `${name}.ts`), manifestSource);
  const hostPath = join(root, 'host', 'modules.json');
  const host = JSON.parse(readFileSync(hostPath, 'utf8')) as { modules: Array<{ id: string }> };
  host.modules.push(registryRow);
  host.modules.sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(hostPath, JSON.stringify(host, null, 2) + '\n');
  console.log(`scaffolded manifests/${name}.ts; add it to manifests/index.ts and tools/gen/lanes.json (frozen list)`);
  process.exit(0);
}

const lanes = JSON.parse(readFileSync(join(here, '..', 'lanes.json'), 'utf8')) as LaneTable;
const loaded = await loadManifests(root);
const problems = validateAll(loaded, lanes);
if (problems.length) {
  console.error(`manifest validation failed: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 400)) console.error('  ' + p);
  if (problems.length > 400) console.error(`  ... and ${problems.length - 400} more`);
  process.exit(1);
}
const registry = buildRegistry(loaded);
if (diffIdx >= 0) {
  // vyre-gen diff --against <registry.json>: a breaking change without a version bump fails (use `git show release/<tag>:generated/registry.json > old.json`)
  const old = JSON.parse(readFileSync(resolve(String(args[diffIdx + 1])), 'utf8')) as Registry;
  const d = diffRegistries(old, dedupeRegistry(registry));
  for (const a of d.additive) console.log('additive  ' + a);
  for (const b of d.breaking) console.error('BREAKING  ' + b);
  if (d.breaking.length) { console.error(`${d.breaking.length} breaking change(s) without a version bump`); process.exit(1); }
  console.log(`no breaking changes (${d.additive.length} additive)`);
  process.exit(0);
}
const files = emitAll(registry);
if (args.includes('--summary')) console.log(summary(registry));
if (args.includes('--snapshots')) {
  // docs/frozen/snapshots: one file per manifest (lib/snapshot.ts). Written from the same deduplicated registry the generated tree holds, never merged by hand.
  const dir = join(root, SNAPSHOT_DIR);
  const want = snapshotFiles(dedupeRegistry(registry));
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) if (!want.has(`${SNAPSHOT_DIR}/${name}`)) rmSync(join(dir, name));
  for (const [p, text] of want) writeFileSync(join(root, p), text);
  console.log(`snapshots: ${want.size} files in ${SNAPSHOT_DIR}`);
  process.exit(0);
}

if (check) {
  const onDisk = new Set(walk(outDir));
  const bad: string[] = [];
  for (const [p, content] of files) {
    if (!onDisk.has(p)) bad.push(`missing  ${p}`);
    else if (readFileSync(join(outDir, p), 'utf8') !== content) bad.push(`changed  ${p}`);
  }
  for (const p of onDisk) if (!files.has(p)) bad.push(`stale    ${p}`);
  if (bad.length) {
    console.error(`generated/ is out of date: ${bad.length} file(s) differ. Run: node tools/gen/src/cli.ts`);
    for (const b of bad.slice(0, 30)) console.error('  ' + b);
    process.exit(1);
  }
  console.log(`generated/ is up to date (${files.size} files)`);
} else {
  if (existsSync(outDir)) for (const p of walk(outDir)) if (!files.has(p)) rmSync(join(outDir, p));
  for (const [p, content] of files) {
    const abs = join(outDir, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  console.log(`wrote ${files.size} files to ${relative(root, outDir) || '.'}`);
}
