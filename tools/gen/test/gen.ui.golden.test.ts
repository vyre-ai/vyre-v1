// Golden output for outputs 12, 15, 16, 17: sync config and replica DDL, block registry, docs, screen index and probes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/build.ts';
import { emitAll } from '../src/emit.ts';
import { loaded } from './fixture.ts';

const files = emitAll(buildRegistry(loaded()));

test('every screen with perf yields a probe id', () => {
  const probes = (JSON.parse(files.get('probes.json') as string) as { probes: Array<{ id: string }> }).probes.map((p) => p.id);
  assert.deepEqual(probes, ['screen.alpha.main']);
});

test('block registry and screen index list the fixture declarations', () => {
  assert.match(files.get('blocks.ts') as string, /AlphaCardBlockData/);
  assert.match(files.get('screens.ts') as string, /"alpha.main"/);
});

test('docs have a page per capability and event, and a lane brief', () => {
  for (const p of ['docs/capabilities/alpha.get.md', 'docs/events/alpha.created.md', 'docs/lanes/L1.md', 'docs/modules/alpha.md']) assert.ok(files.has(p), p);
});

test('sync config and replica DDL exist', () => {
  assert.ok(files.has('sync/entities.ts'));
  assert.match(files.get('sync/replica.sql') as string, /GENERATED/);
});
