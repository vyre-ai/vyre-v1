// Every manifest file is listed in manifests/index.ts, loads, and validates against the lane table and the 3.7 rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { all } from '../../../manifests/index.ts';
import { loadManifests } from '../src/load.ts';
import { validateAll } from '../src/validate.ts';
import type { LaneTable } from '../src/validate.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const lanes = JSON.parse(readFileSync(new URL('../lanes.json', import.meta.url), 'utf8')) as LaneTable;

test('manifests/index.ts lists exactly the manifest files on disk', async () => {
  const loaded = await loadManifests(root);
  assert.deepEqual(loaded.map((l) => l.manifest.id).sort(), all.map((m) => m.id).sort());
});

test('the 72 modules each have one manifest and one owner lane', async () => {
  const loaded = await loadManifests(root);
  const modules = loaded.filter((l) => l.dir === '');
  assert.equal(modules.length, lanes.frozenCount);
});

test('all manifests validate', async () => {
  const loaded = await loadManifests(root);
  assert.deepEqual(validateAll(loaded, lanes), []);
});
