// vyre-gen: node tools/gen/src/cli.ts [--check] [--out <dir>] [--summary]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from './build.ts';
import { emitAll, summary } from './emit.ts';
import { loadManifests } from './load.ts';
import { validateAll } from './validate.ts';
import type { LaneTable } from './validate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const check = args.includes('--check');
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
const files = emitAll(registry);
if (args.includes('--summary')) console.log(summary(registry));

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
