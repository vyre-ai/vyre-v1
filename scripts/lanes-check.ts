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

/**
 * host/modules.json lines are owned per module (ruling 25). A lane may change the `status` of its own module rows (stub to live and back);
 * adding, removing or re-owning a row, or touching another lane's row, is the lead's.
 */
export function checkModulesJsonEdit(lane: string, base: ModuleRow[], head: ModuleRow[], laneTable: LaneTable): string[] {
  const errs: string[] = [];
  const row = laneTable.lanes.find((l) => l.id === lane);
  const mine = (m: ModuleRow) => m.owner === lane || (row?.modules ?? []).includes(m.id);
  const before = new Map(base.map((m) => [m.id, m]));
  const after = new Map(head.map((m) => [m.id, m]));
  for (const id of before.keys()) if (!after.has(id)) errs.push(`host/modules.json: row ${id} removed, only the lead edits the list`);
  for (const [id, h] of after) {
    const b = before.get(id);
    if (!b) { errs.push(`host/modules.json: row ${id} added, only the lead edits the list`); continue; }
    if (b.owner === h.owner && b.status === h.status) continue;
    if (b.owner !== h.owner) errs.push(`host/modules.json: ${id} owner changed, only the lead edits it`);
    else if (!mine(h)) errs.push(`host/modules.json: ${id} is not a ${lane} module, its status line is outside lane ${lane}`);
    else if (h.status !== 'stub' && h.status !== 'live') errs.push(`host/modules.json: ${id} status ${h.status} is neither stub nor live`);
  }
  return errs;
}

export function checkEdits(lane: string, changed: string[], laneTable: LaneTable, modules: ModuleRow[], baseModules?: ModuleRow[]): string[] {
  if (lane === 'lead') return [];
  const row = laneTable.lanes.find((l) => l.id === lane);
  if (!row) return [`unknown lane ${lane}`];
  const own = [...row.owns, ...modules.filter((m) => m.owner === lane).flatMap((m) => [`manifests/${m.id}.ts`, `modules/${m.id}/`])];
  const errs: string[] = [];
  for (const f of changed) {
    if (f === 'host/modules.json' && baseModules) { errs.push(...checkModulesJsonEdit(lane, baseModules, modules, laneTable)); continue; }
    if (under(f, laneTable.frozen)) { errs.push(`${f}: frozen path, only the lead edits it`); continue; }
    if (!under(f, own)) errs.push(`${f}: outside lane ${lane}`);
  }
  return errs;
}

/** Ruling 59: which findings fail the job. Only a plain "outside lane" edit outside the guarded trees is report-only. */
export function splitFindings(errs: string[]): { hard: string[]; soft: string[] } {
  const guarded = (e: string) => /^(generated|manifests|packages\/contracts|tools\/gen|docs\/frozen)\//.test(e);
  const soft = errs.filter((e) => / outside lane /.test(e) && !guarded(e) && !/frozen path/.test(e));
  return { hard: errs.filter((e) => !soft.includes(e)), soft };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lane = process.argv[2] ?? '';
  const base = process.argv[3] ?? 'origin/main';
  const root = fileURLToPath(new URL('..', import.meta.url));
  const table = JSON.parse(readFileSync(new URL('./lanes.json', import.meta.url), 'utf8')) as LaneTable;
  const mods = (JSON.parse(readFileSync(new URL('../host/modules.json', import.meta.url), 'utf8')) as { modules: ModuleRow[] }).modules;
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', `${base}...HEAD`], { cwd: root, encoding: 'utf8' });
  const mb = spawnSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const shown = mb ? spawnSync('git', ['show', `${mb}:host/modules.json`], { cwd: root, encoding: 'utf8' }) : undefined;
  const baseMods = shown && shown.status === 0 ? (JSON.parse(shown.stdout) as { modules: ModuleRow[] }).modules : undefined;
  const errs = [...checkOwnership(mods, table, {}), ...checkEdits(lane, diff.stdout.split('\n').filter(Boolean), table, mods, baseMods)];
  // Ruling 59: "outside lane" is report-only (findings are printed, the job passes); the frozen, generated and manifests guards, the host/modules.json rules and the module-ownership table still fail.
  const { hard, soft } = splitFindings(errs);
  for (const e of soft) console.error(`WARN ${e}`);
  for (const e of hard) console.error(e);
  process.exit(hard.length ? 1 : 0);
}

