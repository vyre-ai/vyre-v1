import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEdits, checkOwnership } from './lanes-check.ts';
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
