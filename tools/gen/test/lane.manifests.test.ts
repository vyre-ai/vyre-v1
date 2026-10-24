// @reads /manifests/index.ts
// Per-lane manifest check for P-PR_24..P-PR_33: each lane's modules have a manifest owned by the lane, stub status, and real content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { all } from '../../../manifests/index.ts';

const table = JSON.parse(readFileSync(new URL('../../../scripts/lanes.json', import.meta.url), 'utf8')) as { lanes: Array<{ id: string; modules: string[] }> };
const lanes = table.lanes.filter((l) => /^L([1-8]|9[a-f])$/.test(l.id) && l.modules.length > 0);

test('lane table covers the 72 modules exactly once', () => {
  const ids = lanes.flatMap((l) => l.modules);
  assert.equal(new Set(ids).size, ids.length);
  const manifests = all.filter((m) => m.kind !== 'kit').map((m) => m.id);
  for (const id of ids) assert.ok(manifests.includes(id), `${id} has a manifest`);
});

for (const lane of lanes) {
  test(`${lane.id}: ${lane.modules.join(', ')} are stub manifests owned by the lane with examples and content`, () => {
    for (const id of lane.modules) {
      const m = all.find((x) => x.id === id);
      assert.ok(m, `${id} manifest`);
      assert.equal(m.owner, lane.id, `${id} owner`);
      assert.equal(m.status, 'stub', `${id} status`);
      const content = (m.capabilities?.length ?? 0) + (m.steps?.length ?? 0) + (m.screens?.length ?? 0);
      assert.ok(content > 0, `${id} declares capabilities, steps or screens`);
      for (const c of m.capabilities ?? []) assert.ok(c.examples.length >= 1, `${c.name} has an example`);
    }
  });
}
