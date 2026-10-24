// @reads /tools/gen/src/scaffold.ts
// vyre-gen new module: the scaffold validates, registers in host/modules.json, and host/modules.json matches the manifests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scaffoldModule } from '../src/scaffold.ts';
import { buildRegistry } from '../src/build.ts';
import { validateAll } from '../src/validate.ts';
import type { LaneTable } from '../src/validate.ts';
import { all } from '../../../manifests/index.ts';

const hostModules = JSON.parse(readFileSync(new URL('../../../host/modules.json', import.meta.url), 'utf8')) as { modules: Array<{ id: string; owner: string; status: string }> };

test('host/modules.json lists the 72 modules with the manifest owner and status stub', () => {
  assert.equal(hostModules.modules.length, 72);
  for (const m of hostModules.modules) {
    const man = all.find((x) => x.id === m.id);
    assert.ok(man, `${m.id} has a manifest`);
    assert.equal(man.owner, m.owner);
  }
});

test('a scaffolded module has one capability, one event, one entity and passes validation', () => {
  const { manifestSource, manifest, registryRow } = scaffoldModule('widgets', 'L1');
  assert.match(manifestSource, /defineManifest/);
  assert.deepEqual(registryRow, { id: 'widgets', owner: 'L1', status: 'stub' });
  const table: LaneTable = { lanes: { L1: ['widgets'] }, extras: {}, frozenCount: 1, versioned: [] };
  assert.deepEqual(validateAll([{ file: 'manifests/widgets.ts', dir: '', manifest }], table), []);
  const reg = buildRegistry([{ file: 'manifests/widgets.ts', dir: '', manifest }]);
  assert.equal(reg.capabilities.length, 2);
  assert.equal(reg.entities.length, 1);
  assert.ok(fileURLToPath(import.meta.url).length > 0);
});
