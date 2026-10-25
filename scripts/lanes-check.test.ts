import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEdits, checkModulesJsonEdit, checkOwnership } from './lanes-check.ts';
import type { LaneTable, ModuleRow } from './lanes-check.ts';

const table: LaneTable = { frozen: ['kernel/', 'generated/'], lanes: [{ id: 'L1', owns: ['sync/', 'modules/sync/'], modules: ['sync'] }, { id: 'L3', owns: ['modules/records/'], modules: ['records'] }] };
const mods: ModuleRow[] = [{ id: 'sync', owner: 'L1', status: 'stub' }, { id: 'records', owner: 'L3', status: 'stub' }];

test('fails on no owner, two owners and a manifest that disagrees', () => {
  assert.ok(checkOwnership([{ id: 'x', owner: '', status: 'stub' }], table, {}).some((e) => e.includes('no owner')));
  assert.ok(checkOwnership([...mods, { id: 'sync', owner: 'L3', status: 'stub' }], table, {}).some((e) => e.includes('2 owners')));
  assert.ok(checkOwnership(mods, table, { sync: 'L3' }).some((e) => e.includes('differs')));
  assert.deepEqual(checkOwnership(mods, table, { sync: 'L1' }), []);
});

test('fails on an edit outside the lane or on a frozen path; passes inside', () => {
  assert.deepEqual(checkEdits('L1', ['sync/src/pull.ts', 'manifests/sync.ts'], table, mods), []);
  assert.ok(checkEdits('L1', ['modules/records/impl.ts'], table, mods).some((e) => e.includes('outside lane L1')));
  assert.ok(checkEdits('L1', ['kernel/log.ts'], table, mods).some((e) => e.includes('frozen')));
  assert.deepEqual(checkEdits('lead', ['kernel/log.ts'], table, mods), []);
});

test('a module registered to a lane is that lane\'s folder and manifest, even if lanes.json lists no prefix for it (a fresh scaffold)', () => {
  const fresh: ModuleRow[] = [...mods, { id: 'widgets', owner: 'L1', status: 'stub' }];
  assert.deepEqual(checkEdits('L1', ['modules/widgets/impl.ts', 'modules/widgets/tests/widgets.contract.test.ts', 'manifests/widgets.ts'], table, fresh), []);
  assert.ok(checkEdits('L3', ['modules/widgets/impl.ts'], table, fresh).some((e) => e.includes('outside lane L3')));
  assert.ok(checkEdits('L1', ['modules/widgets/impl.ts'], table, mods).some((e) => e.includes('outside lane L1')), 'unregistered, it is nobody\'s');
});

test('host/modules.json: a lane flips only its own module status; rows are otherwise the lead\'s (ruling 25)', () => {
  const flipped = (id: string, status: string): ModuleRow[] => mods.map((m) => (m.id === id ? { ...m, status } : m));
  assert.deepEqual(checkModulesJsonEdit('L1', mods, flipped('sync', 'live'), table), []);
  assert.deepEqual(checkEdits('L1', ['host/modules.json'], table, flipped('sync', 'live'), mods), []);
  assert.ok(checkEdits('L1', ['host/modules.json'], table, flipped('records', 'live'), mods).some((e) => e.includes('outside lane L1')));
  assert.ok(checkModulesJsonEdit('L1', mods, flipped('sync', 'maybe'), table).some((e) => e.includes('neither stub nor live')));
  assert.ok(checkModulesJsonEdit('L1', mods, [...mods, { id: 'widgets', owner: 'L1', status: 'stub' }], table).some((e) => e.includes('added')));
  assert.ok(checkModulesJsonEdit('L1', mods, mods.slice(1), table).some((e) => e.includes('removed')));
  assert.ok(checkModulesJsonEdit('L1', mods, mods.map((m) => (m.id === 'sync' ? { ...m, owner: 'L3' } : m)), table).some((e) => e.includes('owner changed')));
  assert.deepEqual(checkEdits('L1', ['host/modules.json'], table, mods, mods), [], 'no change, no error');
});

test("ruling 59: an outside-lane edit is report-only; frozen, generated, manifests and ownership findings still fail", async () => {
  const { splitFindings } = await import("./lanes-check.ts");
  const r = splitFindings([
    "modules/mail/x.ts: outside lane L3",
    "generated/registry.ts: outside lane L3",
    "manifests/mail.ts: outside lane L3",
    "kernel/a.ts: frozen path, only the lead edits it",
    "host/modules.json: row foo added, only the lead edits the list",
    "module mail has no owner",
  ]);
  assert.deepEqual(r.soft, ["modules/mail/x.ts: outside lane L3"]);
  assert.equal(r.hard.length, 5);
});
