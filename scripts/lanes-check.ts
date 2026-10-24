// lanes-check: a lane edits only its own directories; every module has exactly one owner lane.
//   node scripts/lanes-check.ts <lane> <base-ref>      changed files come from `git diff --name-only <base>...HEAD`
// Frozen paths (kernel, contracts, generator, generated, host/modules.json ...) are edited only by the lead (lane "lead").
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface LaneRow { id: string; owns: string[]; modules: string[] }
export interface LaneTable { frozen: string[]; lanes: LaneRow[] }
export interface ModuleRow { id: string; owner: string; status: string }

const under = (file: string, dirs: string[]) => dirs.some((d) => file === d || file.startsWith(d.endsWith('/') ? d : d + '/') || file === d.replace(/\/$/, ''));

export function checkOwnership(modules: ModuleRow[], laneTable: LaneTable, manifestOwners: Record<string, string>): string[] {
  const errs: string[] = [];
  const lanesOf = new Map<string, string[]>();
  for (const l of laneTable.lanes) for (const m of l.modules) lanesOf.set(m, [...(lanesOf.get(m) ?? []), l.id]);
  for (const [id, ls] of lanesOf) if (ls.length > 1) errs.push(`module ${id} has ${ls.length} owners (${ls.join(', ')})`);
  const seen = new Map<string, number>();
  for (const m of modules) seen.set(m.id, (seen.get(m.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) errs.push(`module ${id} has ${n} owners in host/modules.json`);
  for (const m of modules) {
    if (!m.owner) errs.push(`module ${m.id} has no owner`);
    else if (!laneTable.lanes.some((l) => l.id === m.owner)) errs.push(`module ${m.id} owner ${m.owner} is not a lane`);
    else if (!(lanesOf.get(m.id) ?? []).includes(m.owner)) errs.push(`module ${m.id}: lanes.json does not list it under ${m.owner}`);
    if (manifestOwners[m.id] !== undefined && manifestOwners[m.id] !== m.owner) errs.push(`module ${m.id}: manifest owner ${manifestOwners[m.id]} differs from host/modules.json ${m.owner}`);
  }
  return errs;
}

export function checkEdits(lane: string, changed: string[], laneTable: LaneTable, modules: ModuleRow[]): string[] {
  if (lane === 'lead') return [];
  const row = laneTable.lanes.find((l) => l.id === lane);
  if (!row) return [`unknown lane ${lane}`];
  const own = [...row.owns, ...modules.filter((m) => m.owner === lane).map((m) => `manifests/${m.id}.ts`)];
  const errs: string[] = [];
  for (const f of changed) {
    if (under(f, laneTable.frozen)) { errs.push(`${f}: frozen path, only the lead edits it`); continue; }
    if (!under(f, own)) errs.push(`${f}: outside lane ${lane}`);
  }
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lane = process.argv[2] ?? '';
  const base = process.argv[3] ?? 'origin/main';
  const root = fileURLToPath(new URL('..', import.meta.url));
  const table = JSON.parse(readFileSync(new URL('./lanes.json', import.meta.url), 'utf8')) as LaneTable;
  const mods = (JSON.parse(readFileSync(new URL('../host/modules.json', import.meta.url), 'utf8')) as { modules: ModuleRow[] }).modules;
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', `${base}...HEAD`], { cwd: root, encoding: 'utf8' });
  const errs = [...checkOwnership(mods, table, {}), ...checkEdits(lane, diff.stdout.split('\n').filter(Boolean), table, mods)];
  for (const e of errs) console.error(e);
  process.exit(errs.length ? 1 : 0);
}
